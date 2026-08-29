// In-process LRU cache with TTL. Scoped strictly to readWindow per
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md locked decision 5.
//
// - 60 second TTL, fixed (not configurable in v1).
// - 1000 entry max; cheapest-possible LRU using Map insertion order.
// - No metrics, no persistence, no Redis. Process restart clears.

import type {
  SnapshotColumn,
  SnapshotCountWindow,
  TimeWindow,
} from "./types.js";

interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

const MAX_ENTRIES = 1000;
const TTL_MS = 60 * 1000;

const store = new Map<string, CacheEntry<unknown>>();

export function buildCacheKey(
  hostId: string,
  window: TimeWindow | SnapshotCountWindow,
  columns: SnapshotColumn[],
  parsed: boolean,
): string {
  const windowKey =
    "count" in window
      ? `count=${window.count}`
      : `from=${window.fromSecondsAgo}&to=${window.toSecondsAgo ?? 0}`;
  const columnsKey = [...columns].sort().join(",");
  return `${hostId}|${windowKey}|${columnsKey}|parsed=${parsed}`;
}

export function getFromCache<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAtMs) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setInCache<T>(key: string, value: T): void {
  if (store.size >= MAX_ENTRIES) {
    // Cheap LRU: Map preserves insertion order, so the first key is
    // the oldest. Not a true recency-tracking LRU; a true LRU would
    // re-insert on each get. The 60-second TTL keeps the window small
    // enough that insertion-order eviction is good enough.
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
  store.set(key, { value, expiresAtMs: Date.now() + TTL_MS });
}

/** Test-only: invalidate the cache between test runs. */
export function _clearCacheForTests(): void {
  store.clear();
}
