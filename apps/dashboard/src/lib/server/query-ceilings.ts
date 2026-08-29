// G5 (launch gate, round-3 2026-08-25): crude, hard ceilings on the
// ClickHouse-backed read endpoints.
//
// The gate is exactly this: one free account must not be able to melt
// ClickHouse on launch day. It is NOT query-cost accounting (that is
// ledgered fast-follow), and it is deliberately blunt.
//
// Two mechanisms, both needed:
//   1. REQUEST CEILINGS. A request beyond the ceiling is REFUSED with a clean
//      400 stating the limit. It is never silently clamped: a truncated
//      series that looks like a complete one is the failure mode that makes
//      an operator distrust the whole product, and silent clamping is how a
//      caller ends up hammering an endpoint that never gives them what they
//      asked for.
//   2. SERVER-SIDE SETTINGS. Even a within-ceiling query gets bounded by
//      ClickHouse itself, so a pathological row count or a runaway scan dies
//      in the database rather than in our event loop.

import type { ClickHouseSettings } from "@clickhouse/client";

/**
 * Longest window any read endpoint will serve, in hours.
 *
 * Matches the 90-day snapshot retention TTL rather than undercutting it: a
 * 720-hour ceiling made the older 60 days of retained data unqueryable, so we
 * would have been storing history nobody could ask for. Raise this only
 * together with the retention TTL; a ceiling above retention is harmless but
 * a ceiling below it hides data we kept on purpose.
 */
export const MAX_RANGE_HOURS = 2160;

/**
 * Most series points a single response may contain. A 30-day window at the
 * coarsest bucket is 720 points; the ceiling sits above every legitimate
 * combination the UI produces and refuses anything finer.
 */
export const MAX_SERIES_POINTS = 1500;

/**
 * Per-query ClickHouse guardrails. These are the second line: they bound the
 * work a single accepted query may do regardless of what the caller asked
 * for. Values are generous for real fleets and lethal only to abuse.
 */
// Typed against the client's own ClickHouseSettings so a wrong shape is a
// build error, not a setting the server quietly ignores. Note the client's
// convention: UInt64 settings are strings, Seconds is a number.
export const READ_QUERY_SETTINGS: ClickHouseSettings = {
  // A 30-day window for one server is on the order of 10k rows; a million is
  // three orders of magnitude of headroom and still bounds a full-table scan.
  max_rows_to_read: "1000000",
  max_result_rows: "5000",
  max_execution_time: 10,
  max_memory_usage: "1000000000",
  // Refuse rather than silently returning a partial result set.
  result_overflow_mode: "throw",
  read_overflow_mode: "throw",
  timeout_overflow_mode: "throw",
};

export class QueryCeilingError extends Error {
  constructor(
    message: string,
    readonly limit: number,
    readonly requested: number,
  ) {
    super(message);
    this.name = "QueryCeilingError";
  }
}

/**
 * Resolve a requested window to hours, refusing anything past the ceiling.
 * Accepts a named `range` token or a numeric `hours` value. Throws
 * QueryCeilingError (caller returns 400 with the message).
 */
export function resolveRangeHours(
  url: URL,
  rangeTokens: Record<string, number> = {},
  fallbackHours = 24,
): number {
  const range = url.searchParams.get("range");
  if (range) {
    if (range in rangeTokens) return rangeTokens[range];
    throw new QueryCeilingError(
      `Unknown range "${range}". Supported: ${Object.keys(rangeTokens).join(", ")}.`,
      MAX_RANGE_HOURS,
      0,
    );
  }
  const raw = url.searchParams.get("hours");
  if (raw === null) return fallbackHours;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new QueryCeilingError(`Invalid hours "${raw}": expected a positive whole number.`, MAX_RANGE_HOURS, 0);
  }
  if (parsed > MAX_RANGE_HOURS) {
    throw new QueryCeilingError(
      `Requested range of ${parsed} hours exceeds the maximum of ${MAX_RANGE_HOURS} hours (90 days, matching retention). Narrow the window and retry.`,
      MAX_RANGE_HOURS,
      parsed,
    );
  }
  return parsed;
}

/**
 * Refuse a window/resolution combination that would produce more points than
 * the ceiling allows. `bucketMinutes` is the server-chosen bucket width.
 */
export function assertPointBudget(hours: number, bucketMinutes: number): void {
  const points = Math.ceil((hours * 60) / bucketMinutes);
  if (points > MAX_SERIES_POINTS) {
    throw new QueryCeilingError(
      `Requested resolution would return ${points} points, above the maximum of ${MAX_SERIES_POINTS}. Use a shorter range or a coarser resolution.`,
      MAX_SERIES_POINTS,
      points,
    );
  }
}

/**
 * Server-chosen bucket width for a window, in minutes.
 *
 * Every endpoint that returns a series must use this rather than a fixed
 * width. A fixed 5-minute bucket looks fine at 24 hours and silently exceeds
 * the point ceiling from about 5 days onward, which would make our own UI
 * receive a 400 for a range it offers. Widening with the window keeps every
 * first-party request inside MAX_SERIES_POINTS.
 */
export function bucketMinutesFor(hours: number): 5 | 30 | 60 | 180 {
  if (hours <= 24) return 5;
  if (hours <= 168) return 30;
  if (hours <= 720) return 60;
  return 180;
}
