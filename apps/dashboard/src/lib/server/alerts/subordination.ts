// Runtime subordination + incident grouping for the alert ingest path.
//
// Activates the `subordinate_to` and `incident_group` schema primitives
// that shipped declared-but-inert in PR #157 (rule audit foundation).
// Per CC_SPEC_RUNTIME_SUBORDINATION_2026-05-19.md.
//
// Two mechanisms:
//
//   1. Subordination (parent-child).
//      When a child rule's trigger fires AND the declared parent rule
//      is currently active on the same host within the subordination
//      window (default 5 min from parent's first_seen), the child's
//      emission attaches as evidence to the parent's active_alerts
//      row rather than emitting a standalone alert.
//
//   2. Incident grouping (symmetric).
//      When rules sharing the same `incident_group.group_id` trigger
//      on the same host within the correlation window, they merge
//      into one alert. The first to fire creates the incident with
//      `incident_group_key = "<host_id>:<group_id>:<minute_bucket>"`;
//      subsequent siblings within the window attach as evidence on
//      that row instead of emitting separately.
//
// Backward compatibility: rules with neither `subordinate_to` nor
// `incident_group` declared in their YAML route through the default
// path unchanged (independent emission).
//
// Caller responsibility: the ingest endpoint passes (a) the list of
// active alerts already loaded for this host one snapshot ago and (b)
// the rule's metadata. This module decides routing; the caller does
// the SQL writes.

import { getRuleMetadata } from "./fix-workflow/loader.js";
import type { AlertResult } from "./evaluator.js";

/**
 * Minimal structural type for the pg query helper. Matches the
 * `query` function exported from packages/db/src/pg.ts. Keeping
 * this as a structural type avoids needing to import @types/pg
 * (the workspace currently relies on the runtime pg client without
 * the .d.ts package).
 */
type QueryExec = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: any[] }>;

/**
 * Shape of a row from `active_alerts` that subordination logic
 * needs to consult. Loaded once per snapshot ingest per host.
 */
export interface ActiveAlertRow {
  id: number;
  alert_type: string;
  first_seen: Date;
  incident_group_key: string | null;
  parent_alert_id: number | null;
  evidence: Record<string, unknown> | null;
}

/**
 * One of three outcomes for an alert's emission routing.
 */
export type RoutingDecision =
  | {
      kind: "emit_independent";
      // Optional: when a rule declares incident_group AND no existing
      // incident is in-window on this host, the new row's
      // incident_group_key is populated so subsequent siblings can
      // attach to it.
      incident_group_key?: string;
    }
  | {
      kind: "attach_to_parent";
      parent_alert_id: number;
      relationship: "subordinate" | "sibling";
      // For structured logging.
      reason: "subordinate_to" | "incident_group";
    };

/**
 * Default subordination window. The child only routes as evidence on
 * the parent if the parent's `first_seen` is within this many seconds
 * of "now." Per spec §2.1.
 */
const SUBORDINATION_WINDOW_SECONDS = 300;

/**
 * Builds the canonical incident_group_key for a (host, group_id, time)
 * triple. The minute bucket lets sibling rules within the window
 * resolve to the same key even when they fire on slightly different
 * snapshot ticks. See spec §3.1.
 */
function makeIncidentGroupKey(
  serverId: string,
  groupId: string,
  now: Date,
): string {
  // Floor "now" to the minute that started the correlation window.
  // We use minute precision because snapshot cadence is 5+ min;
  // any finer would risk same-window snapshots producing different
  // keys.
  const minuteBucket = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  ).toISOString();
  return `${serverId}:${groupId}:${minuteBucket}`;
}

/**
 * Decide how this alert should route given the current host state.
 * Returns `emit_independent` (with optional new incident_group_key
 * to set on the row) or `attach_to_parent` (with the row id to
 * append evidence to).
 *
 * Order of checks (per spec):
 *   1. If the rule's YAML declares `subordinate_to: <parent>`, look
 *      for an active alert of that parent type within the window. If
 *      found, attach.
 *   2. Else if the rule declares `incident_group: {group_id, ...}`,
 *      look for an active alert on this host already participating
 *      in this group within the window. If found, attach. Otherwise
 *      emit independent and tag the new row's incident_group_key so
 *      future siblings can find it.
 *   3. Else emit independent.
 *
 * The two mechanisms are mutually exclusive per schema (Phase 1
 * refine() guards that), so the order above never produces ambiguity.
 */
/**
 * Subset of RuleMetadata that affects routing. Lets the unit tests
 * avoid loading the full YAML registry; the ingest caller passes
 * the real RuleMetadata returned by getRuleMetadata().
 */
export interface RoutingRule {
  subordinate_to?: string;
  incident_group?: { group_id: string; correlation_window_seconds?: number };
}

export function routeAlertEmission(
  alert: AlertResult,
  serverId: string,
  hostActiveAlerts: readonly ActiveAlertRow[],
  now: Date = new Date(),
  /** Optional rule override for tests; defaults to YAML registry lookup. */
  ruleOverride?: RoutingRule,
): RoutingDecision {
  const rule = ruleOverride ?? getRuleMetadata(alert.type);
  if (!rule) {
    // Rule has no YAML metadata (shouldn't happen for the 38 in-
    // production rules; defensive). Treat as independent.
    return { kind: "emit_independent" };
  }

  // (1) subordinate_to check.
  if (rule.subordinate_to) {
    const parentType = rule.subordinate_to;
    const parent = hostActiveAlerts.find(
      (row) =>
        row.alert_type === parentType &&
        firedWithinSeconds(row.first_seen, now, SUBORDINATION_WINDOW_SECONDS),
    );
    if (parent) {
      return {
        kind: "attach_to_parent",
        parent_alert_id: parent.id,
        relationship: "subordinate",
        reason: "subordinate_to",
      };
    }
    // No parent in window: emit independently. (No incident_group_key
    // because subordinate_to and incident_group are mutually exclusive.)
    return { kind: "emit_independent" };
  }

  // (2) incident_group check.
  if (rule.incident_group) {
    const { group_id, correlation_window_seconds } = rule.incident_group;
    const windowSeconds = correlation_window_seconds ?? 300;
    const groupKeyPrefix = `${serverId}:${group_id}:`;
    const existing = hostActiveAlerts.find(
      (row) =>
        row.incident_group_key !== null &&
        row.incident_group_key.startsWith(groupKeyPrefix) &&
        firedWithinSeconds(row.first_seen, now, windowSeconds),
    );
    if (existing) {
      return {
        kind: "attach_to_parent",
        parent_alert_id: existing.id,
        relationship: "sibling",
        reason: "incident_group",
      };
    }
    // No existing incident: start one, tag the row so future
    // siblings can find it.
    return {
      kind: "emit_independent",
      incident_group_key: makeIncidentGroupKey(serverId, group_id, now),
    };
  }

  // (3) No subordination metadata: independent emission.
  return { kind: "emit_independent" };
}

function firedWithinSeconds(
  firstSeen: Date,
  now: Date,
  windowSeconds: number,
): boolean {
  return now.getTime() - firstSeen.getTime() <= windowSeconds * 1000;
}

/**
 * Merges a child alert's evidence into the parent's `evidence` JSONB
 * field. The parent's existing evidence becomes `evidence.primary` (if
 * it isn't already wrapped); the child appends to `evidence.attached`.
 *
 * Caller passes the SQL exec function (pg query helper) so this stays
 * decoupled from the db client choice.
 */
export async function attachEvidenceToParent(
  exec: QueryExec,
  parentAlertId: number,
  childRule: { rule_id: string; severity?: string },
  childEvidence: Record<string, unknown>,
  relationship: "subordinate" | "sibling",
  attachedAt: Date = new Date(),
): Promise<void> {
  // Read current evidence (so we can append, not overwrite).
  // bola-exempt: parentAlertId is sourced from active_alerts rows already
  // filtered by server_id in loadActiveAlertsForHost; ownership was
  // verified one query upstream in the ingest path.
  const res = await exec(
    `SELECT evidence FROM active_alerts WHERE id = $1 LIMIT 1`,
    [parentAlertId],
  );
  if (res.rows.length === 0) return;
  const raw = res.rows[0]!.evidence;
  let current: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      current = JSON.parse(raw);
    } catch {
      current = {};
    }
  } else if (raw && typeof raw === "object") {
    current = raw as Record<string, unknown>;
  } else {
    current = {};
  }

  // Migrate older "flat" evidence into the {primary, attached} shape
  // on first attach. Idempotent: re-attaching after migration only
  // touches `attached`.
  const isAlreadyWrapped =
    "primary" in current && (typeof current.primary === "object" || current.primary === null);
  const primary = isAlreadyWrapped ? current.primary : { ...current };
  const attached = Array.isArray(current.attached) ? [...current.attached] : [];
  attached.push({
    rule_id: childRule.rule_id,
    relationship,
    evidence: childEvidence,
    severity: childRule.severity ?? null,
    attached_at: attachedAt.toISOString(),
  });

  const merged = { primary, attached };
  // bola-exempt: same ownership chain as the SELECT above.
  await exec(
    `UPDATE active_alerts SET evidence = $2, last_seen = NOW() WHERE id = $1`,
    [parentAlertId, JSON.stringify(merged)],
  );
}

/**
 * Codex F1 fix 2026-05-22: prune the host's active-alerts snapshot down to
 * rows that will still be active after this ingest's resolve pass. The
 * resolver (in api/v1/ingest/+server.ts) sets resolved_at on any row whose
 * alert_type is missing from `currentTypes` AND not in `eventExclusionTypes`.
 * Without this prune, a child rule firing this snapshot can route as evidence
 * onto a parent (or incident-group anchor) that this same snapshot is about
 * to resolve - net effect: parent disappears, child never emits, the operator
 * sees neither.
 *
 * Apply this before calling routeAlertEmission().
 */
export function pruneToSurvivingActiveAlerts(
  rows: readonly ActiveAlertRow[],
  currentTypes: ReadonlySet<string>,
  eventExclusionTypes: readonly string[],
): ActiveAlertRow[] {
  const surviving = new Set<string>([...currentTypes, ...eventExclusionTypes]);
  return rows.filter((row) => surviving.has(row.alert_type));
}

/**
 * Convenience: SELECT the rows the routing decision needs for this
 * host. One round-trip per ingest (the existing per-alert SELECT-then-
 * upsert in event-type alerts is unchanged).
 */
export async function loadActiveAlertsForHost(
  exec: QueryExec,
  serverId: string,
): Promise<ActiveAlertRow[]> {
  const res = await exec(
    `SELECT id, alert_type, first_seen, incident_group_key, parent_alert_id, evidence
     FROM active_alerts
     WHERE server_id = $1 AND resolved_at IS NULL`,
    [serverId],
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    alert_type: r.alert_type,
    first_seen: r.first_seen instanceof Date ? r.first_seen : new Date(r.first_seen),
    incident_group_key: r.incident_group_key,
    parent_alert_id: r.parent_alert_id,
    evidence:
      typeof r.evidence === "string"
        ? safeJsonObject(r.evidence)
        : (r.evidence as Record<string, unknown> | null),
  }));
}

function safeJsonObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * For tests + structured logging. Exported only.
 */
export const _internal = {
  makeIncidentGroupKey,
  firedWithinSeconds,
  SUBORDINATION_WINDOW_SECONDS,
};
