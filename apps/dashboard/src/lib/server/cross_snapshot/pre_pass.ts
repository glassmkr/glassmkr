// Pre-pass loader. Called once per snapshot ingest, before
// evaluateAlerts iterates rules. Inspects each rule's YAML metadata
// for a `cross_snapshot` block; for matching rules, loads the
// declared snapshot window (via readWindow) and, optionally, the
// declared cross-rule correlation (via correlatedRulesActive). All
// loads run concurrently via Promise.all so the pre-pass latency is
// bounded by the slowest single load, not the sum.
//
// Per CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §2.2 + locked
// decision 6. Rule iteration in evaluateAlerts stays synchronous;
// only this pre-pass step is async.

import { listMetadataRuleTypes, getRuleMetadata } from "../alerts/fix-workflow/loader.js";

import { correlatedRulesActive, type QueryExec } from "./correlation.js";
import { readWindow } from "./read_window.js";
import type { CorrelationResult, SnapshotRow } from "./types.js";

export interface CrossSnapshotRulePayload {
  snapshots: SnapshotRow[];
  correlation: CorrelationResult | null;
}

export interface RunPrePassDeps {
  /** Pg query helper. Same shape correlation.ts QueryExec consumes. */
  pg: QueryExec;
}

/**
 * Run the pre-pass for one host. Returns a Map keyed by rule type;
 * only rules with a `cross_snapshot` YAML block appear in the map.
 *
 * Errors are isolated per rule: one rule's failed readWindow / pg
 * query does not break the pre-pass for other rules. Failed rules
 * are simply absent from the returned map, which evaluator code
 * treats the same as a rule without a cross_snapshot block (no
 * payload available, evaluate() returns []).
 *
 * Cache amplification: when multiple rules request the same
 * (window, columns) shape on the same host, the readWindow cache
 * collapses them to one ClickHouse query.
 */
export async function runPrePass(
  hostId: string,
  mutedRules: ReadonlySet<string> | string[] | undefined,
  deps: RunPrePassDeps,
): Promise<Map<string, CrossSnapshotRulePayload>> {
  const out = new Map<string, CrossSnapshotRulePayload>();
  const muted: ReadonlySet<string> = Array.isArray(mutedRules)
    ? new Set(mutedRules)
    : (mutedRules ?? new Set());

  const targets: Array<{
    ruleType: string;
    snapshotsPromise: Promise<SnapshotRow[]>;
    correlationPromise: Promise<CorrelationResult | null>;
  }> = [];

  for (const ruleType of listMetadataRuleTypes()) {
    if (muted.has(ruleType)) continue;
    const meta = getRuleMetadata(ruleType);
    const cs = meta?.cross_snapshot;
    if (!cs) continue;

    targets.push({
      ruleType,
      snapshotsPromise: readWindow(hostId, cs.window, {
        columns: cs.columns,
        parsed: cs.parsed,
      }).catch((err) => {
        console.error(
          `[pre-pass] readWindow failed for rule ${ruleType} on host ${hostId}:`,
          err,
        );
        return [] as SnapshotRow[];
      }),
      correlationPromise: cs.correlate_with
        ? correlatedRulesActive(
            deps.pg,
            hostId,
            cs.correlate_with.rule_ids,
            cs.correlate_with.window_seconds,
          ).catch((err) => {
            console.error(
              `[pre-pass] correlatedRulesActive failed for rule ${ruleType} on host ${hostId}:`,
              err,
            );
            return null;
          })
        : Promise.resolve(null),
    });
  }

  if (targets.length === 0) return out;

  // Await all loads in parallel.
  const settled = await Promise.all(
    targets.map(async (t) => ({
      ruleType: t.ruleType,
      snapshots: await t.snapshotsPromise,
      correlation: await t.correlationPromise,
    })),
  );

  for (const r of settled) {
    out.set(r.ruleType, {
      snapshots: r.snapshots,
      correlation: r.correlation,
    });
  }
  return out;
}
