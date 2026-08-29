// Snapshot validation-failure logger (Phase 1: log-mode).
//
// Failures are written to a dedicated log stream (stderr with a fixed
// prefix) so log shippers can route them to a separate index, and an
// in-memory counter tracks the rate so the version-notify watchdog
// can warn the operator if drift is rising.
//
// IMPORTANT: never log the raw payload. Telemetry contains hostnames,
// IP addresses, sensor data, and free-text security fields. Log only
// the structured field paths + zod reason strings, plus the server_id
// (which is already a customer-bound opaque identifier, so it doesn't
// add disclosure risk over what the audit log already records).
//
// Spec rationale: master plan Phase 1 (CC_NEXT_PHASE_MASTER_PLAN.md).
// "On validation failure, log to a dedicated stream with the offending
// payload structure (NOT the raw payload; redact telemetry contents).
// Surface count metric."

const PREFIX = "[ingest-validation]";

// Cap on how many issue lines we emit per snapshot. The route is
// authenticated + rate-limited, so an attacker can't fire arbitrary
// payloads, but a deeply malformed legitimate snapshot (or a
// misconfigured collector pushing huge invalid arrays) can still
// produce hundreds of issue rows. Cap the per-snapshot emission
// volume; aggregate the remainder into a single summary line so the
// per-path counters stay accurate. Codex 2026-05-12 P3.
const MAX_LOGGED_ISSUES_PER_PAYLOAD = 20;

let failuresTotal = 0;
let failuresByPathTotal = new Map<string, number>();

export interface ValidationFailureEvent {
  /** server_id authenticated via the ingest path. Always set; the
   *  caller must have authenticated before calling this. */
  serverId: string;
  /** collector_version from the envelope, when present. Helps spot
   *  schema drift caused by a specific agent build. */
  collectorVersion?: string;
  /** Structured failures from parseSnapshot(). */
  issues: ReadonlyArray<{ path: string; code: string; message: string }>;
}

/**
 * Record a snapshot validation failure. Returns void; never throws.
 *
 * Cost: O(issues) string work + a console.warn. The caller is the
 * ingest hot path so we keep it cheap.
 */
export function logSnapshotValidationFailure(ev: ValidationFailureEvent): void {
  failuresTotal += 1;
  for (const issue of ev.issues) {
    failuresByPathTotal.set(
      issue.path,
      (failuresByPathTotal.get(issue.path) ?? 0) + 1,
    );
  }
  // One line per failure (up to the per-snapshot cap), structured.
  // Log shipper can grep on the prefix. We log the issue path + code
  // + message but NOT the offending value. Beyond the cap we emit a
  // single summary line so the per-path counters above remain
  // authoritative even when the per-line stream is truncated.
  const logged = Math.min(ev.issues.length, MAX_LOGGED_ISSUES_PER_PAYLOAD);
  for (let i = 0; i < logged; i++) {
    const issue = ev.issues[i];
    console.warn(
      `${PREFIX} server=${ev.serverId} agent=${ev.collectorVersion ?? "unknown"} ` +
      `path=${issue.path} code=${issue.code} reason=${JSON.stringify(issue.message)}`,
    );
  }
  if (ev.issues.length > MAX_LOGGED_ISSUES_PER_PAYLOAD) {
    const omitted = ev.issues.length - MAX_LOGGED_ISSUES_PER_PAYLOAD;
    console.warn(
      `${PREFIX} server=${ev.serverId} agent=${ev.collectorVersion ?? "unknown"} ` +
      `omitted=${omitted} reason="per-payload log cap reached; counters unaffected"`,
    );
  }
}

/**
 * Read the current count of validation failures since process start.
 * Used by the version-notify watchdog and exposed via internal admin
 * endpoint (future).
 */
export function getValidationFailureCounters(): {
  total: number;
  byPath: ReadonlyMap<string, number>;
} {
  return { total: failuresTotal, byPath: failuresByPathTotal };
}

/** Test-only: reset the in-process counters. */
export function resetValidationFailureCountersForTests(): void {
  failuresTotal = 0;
  failuresByPathTotal = new Map<string, number>();
}
