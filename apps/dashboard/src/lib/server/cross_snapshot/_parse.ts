// Shape-tolerant JSON parser shared by the library and trend-warnings.
//
// Originally lived in trend-warnings/features.ts (Codex 2026-05-12 P2).
// Hoisted to the library so the alert evaluator's parsed: true path
// uses the same guards (malformed ClickHouse columns must not throw
// at the consumer boundary).

/** Parse a ClickHouse JSON-string column, returning the fallback on failure. */
export function safeParse<T>(
  raw: string | null | undefined | unknown,
  fallback: T,
): T {
  if (raw == null) return fallback;
  // Some ClickHouse columns arrive already-parsed (object/array) when
  // the client materialises JSON types. Only parse when we received a
  // string.
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
  } else {
    parsed = raw;
  }
  // Guard against shape mismatches (e.g. column contained an object
  // where we expected an array). Returning the fallback prevents
  // downstream "not iterable" errors from propagating.
  if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
  return parsed as T;
}
