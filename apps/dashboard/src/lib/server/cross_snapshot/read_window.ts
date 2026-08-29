// Snapshot window reader. Extracted from
// apps/dashboard/src/lib/server/trend-warnings/features.ts (the inline
// ClickHouse query at lines 80-99) and generalised per
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §1.3.
//
// Supports two window shapes:
//   - TimeWindow: SELECT ... WHERE timestamp >= now() - INTERVAL N
//     (fromSecondsAgo) AND timestamp <= now() - INTERVAL M (toSecondsAgo);
//   - SnapshotCountWindow: SELECT ... ORDER BY timestamp DESC LIMIT N,
//     then re-sorted ascending for caller convenience.
//
// Results are cached for 60 seconds per (host, window, columns, parsed)
// tuple. Per cache.ts: in-process LRU, 1000-entry cap, process-restart
// clears.

import { clickhouse } from "@glassmkr/db/clickhouse";

import { buildCacheKey, getFromCache, setInCache } from "./cache.js";
import { safeParse } from "./_parse.js";
import type {
  ReadWindowOptions,
  SnapshotColumn,
  SnapshotCountWindow,
  SnapshotRow,
  TimeWindow,
} from "./types.js";

/**
 * Read a window of snapshot rows for one host.
 *
 * The default column set is just `timestamp` — callers must pass the
 * columns they actually need (matches the trend-warnings pattern and
 * keeps the ClickHouse projection narrow).
 */
export async function readWindow(
  hostId: string,
  window: TimeWindow | SnapshotCountWindow,
  opts: ReadWindowOptions = {},
): Promise<SnapshotRow[]> {
  const columns: SnapshotColumn[] = opts.columns ?? ["timestamp"];
  const parsed = opts.parsed ?? false;

  const cacheKey = buildCacheKey(hostId, window, columns, parsed);
  const cached = getFromCache<SnapshotRow[]>(cacheKey);
  if (cached) return cached;

  // Ensure `timestamp` is always in the projection (callers may omit
  // it but every consumer relies on the unix-ms field downstream).
  const projection = columns.includes("timestamp")
    ? columns
    : (["timestamp", ...columns] as SnapshotColumn[]);

  const rows = await runQuery(hostId, window, projection);

  // Always coerce timestamp to unix ms regardless of parsed flag.
  // ClickHouse delivers DateTime as ISO string by default; trend-
  // warnings was doing the conversion at every callsite.
  const normalised: SnapshotRow[] = rows.map((row) => {
    const ts = (row as { timestamp: unknown }).timestamp;
    const tsMs =
      typeof ts === "number"
        ? ts
        : typeof ts === "string"
          ? new Date(ts).getTime()
          : 0;
    if (!parsed) {
      return { ...row, timestamp: tsMs };
    }
    // parsed: true — apply safeParse over JSON columns.
    const out: SnapshotRow = { timestamp: tsMs };
    for (const col of projection) {
      if (col === "timestamp") continue;
      const raw = (row as Record<string, unknown>)[col];
      // We don't know the column's target shape here (varies per
      // column). Default fallback is null; the alert evaluator
      // narrows downstream. safeParse still guards against malformed
      // strings.
      out[col] = safeParse<unknown>(raw, null);
    }
    return out;
  });

  setInCache(cacheKey, normalised);
  return normalised;
}

async function runQuery(
  hostId: string,
  window: TimeWindow | SnapshotCountWindow,
  columns: SnapshotColumn[],
): Promise<Array<Record<string, unknown>>> {
  // Stable, alphabetised projection list (timestamp first for
  // readability when reviewing emitted SQL in logs).
  const tsFirst = ["timestamp", ...columns.filter((c) => c !== "timestamp")];
  const projection = tsFirst.join(", ");

  if ("count" in window) {
    const rows = await clickhouse
      .query({
        query: `
          -- clickhouse-lint-allow: projection is built from SnapshotColumn[]
          -- which is a z.enum() closed allowlist (SnapshotColumnSchema); no
          -- arbitrary string can reach the SELECT list. Identifiers can't be
          -- parameterized in ClickHouse.
          SELECT ${projection}
          FROM snapshots
          WHERE server_id = {serverId:String}
          ORDER BY timestamp DESC
          LIMIT {limit:UInt32}
        `,
        query_params: { serverId: hostId, limit: window.count },
        format: "JSONEachRow",
      })
      .then((r) => r.json<Record<string, unknown>>());
    // Caller expects ascending order.
    return rows.reverse();
  }

  // TimeWindow.
  const from = window.fromSecondsAgo;
  const to = window.toSecondsAgo ?? 0;
  const rows = await clickhouse
    .query({
      query: `
        -- clickhouse-lint-allow: projection is built from SnapshotColumn[]
        -- which is a z.enum() closed allowlist (SnapshotColumnSchema); no
        -- arbitrary string can reach the SELECT list. Identifiers can't be
        -- parameterized in ClickHouse.
        SELECT ${projection}
        FROM snapshots
        WHERE server_id = {serverId:String}
          AND timestamp >= now() - INTERVAL {fromSec:UInt32} SECOND
          AND timestamp <= now() - INTERVAL {toSec:UInt32} SECOND
        ORDER BY timestamp ASC
      `,
      query_params: { serverId: hostId, fromSec: from, toSec: to },
      format: "JSONEachRow",
    })
    .then((r) => r.json<Record<string, unknown>>());
  return rows;
}
