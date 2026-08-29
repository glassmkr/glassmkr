// Trend warnings batch job.
//
// Runs every 6 hours (00:00, 06:00, 12:00, 18:00 UTC). For each active Pro
// server, extracts features, runs triggers, applies correlation, checks
// persistence, and dispatches notifications for findings that pass all gates.
//
// Disk-space prediction runs for all plans (works on 7-day data).
//
// Phase 2+3 (2026-05-14): per-customer evaluation counters are aggregated
// during the batch and written to `trend_warning_evaluations`. Servers
// younger than SERVER_AGE_MIN_DAYS_FOR_TREND are counted as
// `candidates_considered` (and `servers_skipped_young`) but not put
// through the metric triggers, because slope-based and delta-based
// triggers produce noise on partial history (gpu-1 setup-time false
// positive was the surfaced case). They DO still get the alert-stream
// flapping detector (2026-07-01): it needs only 6h of alert_history, and
// the skip used to swallow it, leaving brand-new noisy hosts (the Vast
// fleet) with no flapping warnings for their first week.
//
// Spec: 07-trend-warnings-spec-v2.md, Scheduled Job
// + ~/Documents/Glassmkr/CC_TREND_WARNINGS_UI_HONESTY.md (Phase 2+3)

import { query } from "@glassmkr/db/pg";
import { extractFeatures } from "./features";
import { runDeterministicTriggers, diskSpaceTriggers } from "./triggers";
import { applyCorrelationRules } from "./correlation";
import {
  computeUrgencyTier,
  upsertAndCheckPersistence,
  resolveStaleWarnings,
  markNotified,
} from "./persistence";
import { narrate } from "./narration";
import { dispatchTrendWarning } from "./dispatch";
import { applyTreeRanker } from "./tree-ranker";
import { detectFlappingAlerts } from "./flapping";
import type { Finding, ServerFeatures } from "./types";

/**
 * Minimum server age in days before slope-based and delta-based triggers
 * run on its data. Servers younger than this are counted as evaluated but
 * skipped to avoid first-day-write-spike false positives (the gpu-1
 * `disk_fill_imminent` shape that resolved itself one batch later).
 *
 * Set to 7 days because all major trigger windows are 7+ days (smart 7d/
 * 30d deltas, fan 14d decline, NIC 7d errors, disk-space slope from
 * regression). Anything shorter and the slope picks up boot-time spikes.
 */
export const SERVER_AGE_MIN_DAYS_FOR_TREND = 7;
const SERVER_AGE_MIN_MS = SERVER_AGE_MIN_DAYS_FOR_TREND * 86_400_000;

interface CustomerCounters {
  candidates_considered: number;          // every server iterated for this customer
  candidates_above_threshold: number;     // server produced ≥1 finding
  candidates_passed_persistence: number;  // warnings that reached the 2-batch gate this batch
  warnings_emitted: number;                // warnings actually notified to channels
  servers_skipped_young: number;          // count of servers skipped due to <7-day age
}

function emptyCounters(): CustomerCounters {
  return {
    candidates_considered: 0,
    candidates_above_threshold: 0,
    candidates_passed_persistence: 0,
    warnings_emitted: 0,
    servers_skipped_young: 0,
  };
}

/**
 * Run the full trend warnings pipeline for all active servers.
 * Called by node-cron every 6 hours.
 */
export async function runTrendWarningsBatch(): Promise<void> {
  console.log("[trend-warnings] Starting batch run");
  const startTime = Date.now();
  let processed = 0;
  let totalFindings = 0;
  let totalNotified = 0;
  let errors = 0;

  // Per-customer counters aggregated as we iterate servers.
  const perCustomer = new Map<string, CustomerCounters>();

  // Get all active servers with their customer plan + age.
  const serversResult = await query(
    `SELECT s.id, s.hostname, s.customer_id, s.created_at, c.plan
     FROM servers s
     JOIN customers c ON s.customer_id = c.id
     WHERE s.status = 'active'
       AND NOT c.is_demo`
  );

  for (const server of serversResult.rows) {
    const customerId = server.customer_id as string;
    if (!perCustomer.has(customerId)) perCustomer.set(customerId, emptyCounters());
    const counters = perCustomer.get(customerId)!;

    // Every iterated server is a candidate considered, even when skipped
    // for age. That's the honesty point: the system looked at it.
    counters.candidates_considered++;

    const createdAt = new Date(server.created_at as string).getTime();
    const ageMs = Date.now() - createdAt;

    if (ageMs < SERVER_AGE_MIN_MS) {
      // Skip slope/delta triggers; record the skip so the surfacing
      // narrative can be honest ("evaluated N, skipped K young").
      counters.servers_skipped_young++;
      // The flapping detector still runs: it reads the last 6h of the
      // alert_history fire stream, not metric history, so server age is
      // irrelevant to it. A brand-new noisy host is exactly where
      // flapping shows up first (the Vast fleet flapped smart_failing
      // for 2 days with zero trend warnings because this skip used to
      // swallow the detector too).
      try {
        const stats = await processServer(server.id, server.hostname, server.plan, true);
        processed++;
        totalFindings += stats.findings;
        totalNotified += stats.notified;
        if (stats.findings > 0) counters.candidates_above_threshold++;
        counters.candidates_passed_persistence += stats.passedPersistence;
        counters.warnings_emitted += stats.notified;
      } catch (err: any) {
        errors++;
        console.error(`[trend-warnings] Flapping-only pass failed for ${server.id} (${server.hostname}):`, err?.message ?? err);
      }
      continue;
    }

    try {
      const stats = await processServer(server.id, server.hostname, server.plan);
      processed++;
      totalFindings += stats.findings;
      totalNotified += stats.notified;
      if (stats.findings > 0) counters.candidates_above_threshold++;
      counters.candidates_passed_persistence += stats.passedPersistence;
      counters.warnings_emitted += stats.notified;
    } catch (err: any) {
      errors++;
      console.error(`[trend-warnings] Failed for server ${server.id} (${server.hostname}):`, err?.message ?? err);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[trend-warnings] Batch complete: ${processed} servers, ${totalFindings} findings, ${totalNotified} notified, ${errors} errors, ${duration}s`
  );

  // Write per-customer evaluation rows.
  try {
    await writeEvaluations(perCustomer);
  } catch (err: any) {
    console.error("[trend-warnings] Failed to write evaluations:", err?.message ?? err);
  }

  // Update the self-audit metrics snapshot
  try {
    await updateMetricsSnapshot();
  } catch (err: any) {
    console.error("[trend-warnings] Failed to update metrics snapshot:", err?.message ?? err);
  }
}

async function writeEvaluations(perCustomer: Map<string, CustomerCounters>): Promise<void> {
  for (const [customerId, c] of perCustomer) {
    await query(
      `INSERT INTO trend_warning_evaluations
        (customer_id, candidates_considered, candidates_above_threshold,
         candidates_passed_persistence, warnings_emitted, servers_skipped_young)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        customerId,
        c.candidates_considered,
        c.candidates_above_threshold,
        c.candidates_passed_persistence,
        c.warnings_emitted,
        c.servers_skipped_young,
      ],
    );
  }
}

async function processServer(
  serverId: string,
  hostname: string,
  plan: string,
  /**
   * Reduced pass for servers younger than SERVER_AGE_MIN_DAYS_FOR_TREND:
   * skip the metric feature/trigger stages (slope and delta triggers are
   * noise on partial history) but still run the alert-stream flapping
   * detector, which needs only 6h of alert_history.
   */
  flappingOnly = false,
): Promise<{ findings: number; notified: number; passedPersistence: number }> {
  // P0-03 resolution, 2026-08-29: hosted has no paid tier, so every account
  // gets the full trigger set and correlation. `plan` stays in the signature
  // because callers pass it and the audit metadata still records it; it no
  // longer selects behaviour.
  void plan;
  const isPro = true;
  const stats = { findings: 0, notified: 0, passedPersistence: 0 };

  // Alert-stream flapping detection (round-2 C-1). Independent of the metric
  // triggers and runs on every plan and every server age: it reads the
  // alert_history fire stream, not snapshot metrics. Emits one
  // "alert_flapping" finding per (host, rule) that fired and cleared >=3
  // separate times in the last 6h.
  const flappingFindings = await detectFlappingAlerts(serverId, hostname);

  // Stage 1: Extract features from ClickHouse
  // Stage 2: Run deterministic triggers
  let features: ServerFeatures | null = null;
  let findings: Finding[] = [];
  if (!flappingOnly) {
    features = await extractFeatures(serverId);
    if (isPro) {
      // Pro: full trigger set
      findings = runDeterministicTriggers(features);
    } else {
      // Free: disk space prediction only (works on 7-day data)
      findings = diskSpaceTriggers(features);
    }
  }

  if (findings.length === 0 && flappingFindings.length === 0) {
    // No findings this batch; resolve any stale warnings
    await resolveStaleWarnings(serverId, []);
    return stats;
  }
  stats.findings = findings.length + flappingFindings.length;

  // Stage 3: Correlation (Pro only; Free findings skip correlation). Track
  // observation warning IDs too so resolveStaleWarnings below doesn't churn
  // long-lived single-signal observations into new rows every batch.
  const seenWarningIds: number[] = [];
  let escalated: Finding[];
  if (features && isPro) {
    const result = applyCorrelationRules(findings, features);
    escalated = result.escalated;
    for (const obs of result.observations) {
      const tier = "watch" as const;
      const { warningId } = await upsertAndCheckPersistence(serverId, obs, tier, null);
      seenWarningIds.push(warningId);
    }
  } else {
    // Free tier (disk space findings only) and the flapping-only pass
    // (findings is empty) go through without correlation.
    escalated = findings;
  }

  // Flapping findings are self-sufficient (the >=3-cluster threshold IS the
  // signal); they skip correlation and join the escalated set directly for
  // narration + persistence. Medium severity => "scheduled" tier =>
  // dashboard-visible, not paged.
  escalated.push(...flappingFindings);

  // Stage 2.5: Tree ranker adjusts severity for drive findings using a
  // LightGBM model trained on Backblaze public data. No-op if model absent.
  // Skipped in the flapping-only pass: no features, and flapping findings
  // are not drive findings.
  if (features) await applyTreeRanker(escalated, features);

  for (const finding of escalated) {
    const urgencyTier = computeUrgencyTier(finding);

    // Stage 4: LLM narration with template fallback
    const narration = await narrate(finding, hostname);

    const { warningId, shouldNotify } = await upsertAndCheckPersistence(
      serverId, finding, urgencyTier, narration
    );

    seenWarningIds.push(warningId);
    // shouldNotify implies the persistence gate passed (2 consecutive
    // batches OR an immediate type). Count it here so the per-customer
    // evaluations row can distinguish "this batch advanced the count"
    // from "still on its first batch."
    if (shouldNotify) stats.passedPersistence += 1;

    if (shouldNotify) {
      let delivered = false;
      try {
        const res = await dispatchTrendWarning(serverId, warningId, finding, narration, urgencyTier);
        delivered = res.delivered;
        // If we had channels to try but none succeeded, log loudly so the
        // next batch retries (markNotified is only set on delivery).
        if (res.attempted && !res.delivered) {
          console.error(
            `[trend-warnings] dispatch failed for warning ${warningId}: ${res.channelsTried} channel(s) tried, 0 delivered`
          );
        }
        // If there were no channels subscribed at this priority, treat as
        // "nothing to do" and mark notified so we don't loop forever.
        if (!res.attempted) delivered = true;
      } catch (err: any) {
        console.error(`[trend-warnings] dispatch failed for warning ${warningId}:`, err?.message ?? err);
      }
      if (delivered) {
        await markNotified(warningId);
        stats.notified += 1;
        console.log(
          `[trend-warnings] NOTIFY server=${hostname} type=${finding.type} severity=${finding.severity} tier=${urgencyTier} correlation=${finding.correlation_match ?? "none"}`
        );
      }
    }
  }

  // Resolve warnings that didn't appear in this batch
  await resolveStaleWarnings(serverId, seenWarningIds);
  return stats;
}

/**
 * Update the daily metrics snapshot for the self-audit track record.
 * Runs at the end of each batch. Upserts today's row.
 */
async function updateMetricsSnapshot(): Promise<void> {
  const result = await query(`
    SELECT
      COUNT(*) FILTER (WHERE notified_at IS NOT NULL) AS warnings_sent,
      COUNT(*) FILTER (WHERE user_feedback = 'valuable') AS warnings_confirmed,
      COUNT(*) FILTER (WHERE user_feedback = 'false_positive') AS warnings_dismissed,
      COUNT(*) FILTER (WHERE user_feedback IS NULL AND resolved_at IS NULL) AS warnings_pending
    FROM trend_warnings
    WHERE first_detected_at >= CURRENT_DATE - INTERVAL '90 days'
  `);

  const stats = result.rows[0];
  const confirmed = parseInt(stats.warnings_confirmed, 10);
  const dismissed = parseInt(stats.warnings_dismissed, 10);
  const precision = confirmed + dismissed > 0
    ? confirmed / (confirmed + dismissed)
    : null;

  // Count warnings that were followed by a matching rule-based alert within 30 days
  const precededResult = await query(`
    SELECT COUNT(DISTINCT tw.id) AS n
    FROM trend_warnings tw
    JOIN active_alerts aa ON aa.server_id = tw.server_id
      AND aa.alert_type LIKE '%' || SPLIT_PART(tw.warning_type, '_', 1) || '%'
      AND aa.first_seen BETWEEN tw.first_detected_at AND tw.first_detected_at + INTERVAL '30 days'
    WHERE tw.first_detected_at >= CURRENT_DATE - INTERVAL '90 days'
      AND tw.notified_at IS NOT NULL
  `);

  await query(`
    INSERT INTO trend_warning_metrics_snapshot
      (snapshot_date, warnings_sent, warnings_confirmed, warnings_dismissed,
       warnings_pending, precision_estimate, warnings_that_preceded_alert)
    VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      warnings_sent = EXCLUDED.warnings_sent,
      warnings_confirmed = EXCLUDED.warnings_confirmed,
      warnings_dismissed = EXCLUDED.warnings_dismissed,
      warnings_pending = EXCLUDED.warnings_pending,
      precision_estimate = EXCLUDED.precision_estimate,
      warnings_that_preceded_alert = EXCLUDED.warnings_that_preceded_alert
  `, [
    parseInt(stats.warnings_sent, 10),
    confirmed,
    dismissed,
    parseInt(stats.warnings_pending, 10),
    precision,
    parseInt(precededResult.rows[0].n, 10),
  ]);
}
