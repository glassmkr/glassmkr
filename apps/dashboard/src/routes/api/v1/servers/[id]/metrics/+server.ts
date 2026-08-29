// scope: read
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { safeParse } from "$lib/server/cross_snapshot";
import { take, TIER_CH_READ, TIER_CH_READ_DEMO } from "$lib/server/auth/rate-limit";
import {
  resolveRangeHours,
  assertPointBudget,
  bucketMinutesFor,
  QueryCeilingError,
  READ_QUERY_SETTINGS,
} from "$lib/server/query-ceilings";

// GET /api/v1/servers/:id/metrics?range=24h  (or ?hours=24 as a fallback)
// Same as history but at the path the SnapshotChart component expects.

// Named ranges the UI may send, mapped to a window in hours.
const RANGE_TO_HOURS: Record<string, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 168,
  "30d": 720,
};

// Resolve the requested window in hours, accepting either a named ?range=
// token (preferred) or a numeric ?hours= fallback. Defaults to 24h. G5
// (round-3): a window past the ceiling is REFUSED with a 400 stating the
// limit rather than silently clamped, and the ceiling stays inside the
// 90-day retention TTL either way.
function resolveHours(url: URL): number {
  return resolveRangeHours(url, RANGE_TO_HOURS, 24);
}

// Adaptive bucket width: keep the returned series to a sane point count so a
// 30d window does not ship every raw 60s snapshot. <=24h -> 5m, 7d -> 30m,
// 30d -> 1h. ClickHouse INTERVAL takes a literal, so we interpolate a vetted
// string (never user input) into the query.
function bucketInterval(hours: number): string {
  // Derived from the shared helper so the interval literal and the point
  // budget can never disagree about how wide a bucket is.
  const m = bucketMinutesFor(hours);
  return m === 5 ? "5 MINUTE" : m === 30 ? "30 MINUTE" : m === 60 ? "1 HOUR" : "3 HOUR";
}

export const GET: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");

  // G5 (launch gate): six ClickHouse queries per call, previously behind no
  // limiter at all. Per-account budget, tighter for the shared demo.
  const tier = event.locals.customer?.isDemo ? TIER_CH_READ_DEMO : TIER_CH_READ;
  const budget = await take(tier, principal.customer_id);
  if (!budget.allowed) {
    return json(
      { error: "Query budget exceeded.", retry_after_seconds: budget.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
    );
  }

  try {
    // Verify ownership
    const serverResult = await query(
      `SELECT id FROM servers WHERE id = $1 AND customer_id = $2`,
      [event.params.id, principal.customer_id]
    );
    if (serverResult.rows.length === 0) {
      return json({ error: "Server not found" }, { status: 404 });
    }

    let hours: number;
    let interval: string;
    try {
      hours = resolveHours(event.url);
      interval = bucketInterval(hours);
      assertPointBudget(hours, bucketMinutesFor(hours));
    } catch (e) {
      if (e instanceof QueryCeilingError) {
        return json({ error: e.message, limit: e.limit, requested: e.requested }, { status: 400 });
      }
      throw e;
    }

    const histResult = await clickhouse.query({
      // clickhouse-lint-allow: `interval` is a vetted bucketInterval() literal ("5 MINUTE" / "30 MINUTE" / "1 HOUR"), never user input. CH INTERVAL needs a literal, not a {param}.
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${interval}) AS ts,
          avg(cpu_user_percent) AS cpu_user,
          avg(cpu_system_percent) AS cpu_system,
          avg(cpu_iowait_percent) AS cpu_iowait,
          avg(ram_used_mb) AS ram_used,
          max(ram_total_mb) AS ram_total,
          avg(ram_free_mb) AS ram_free,
          avg(ram_available_mb) AS ram_available,
          avg(swap_used_mb) AS swap_used,
          avg(load_1m) AS load_1m
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: event.params.id, hours },
      format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
    });
    const history = await histResult.json();

    // Network throughput (separate query since it needs JSON parsing).
    // argMax(network, timestamp) takes the latest blob per bucket so we ship
    // one row per interval instead of every raw 60s snapshot.
    //
    // The result alias MUST NOT match the source column name. On ClickHouse
    // 26.x (prod runs 26.3) the analyzer binds an identifier in WHERE to a
    // SELECT alias of the same name; the cpu_cores query below additionally
    // filters `WHERE cpu_cores != ''`, so `... AS cpu_cores` made the WHERE
    // resolve to the aggregate -> "Aggregate function ... is found in WHERE"
    // (ILLEGAL_AGGREGATION, code 184), 500ing the endpoint fleet-wide. This
    // shipped in #268. CI's ClickHouse 24.8 binds to the column instead, so
    // it never reproduced; the integration CH image is bumped to match prod.
    // Alias to `*_latest` and the collision is gone on every version.
    const netResult = await clickhouse.query({
      // clickhouse-lint-allow: `interval` is a vetted bucketInterval() literal ("5 MINUTE" / "30 MINUTE" / "1 HOUR"), never user input. CH INTERVAL needs a literal, not a {param}.
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${interval}) AS ts,
          argMax(network, timestamp) AS network_latest
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: event.params.id, hours },
      format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
    });
    const netRaw: any[] = await netResult.json();
    const networkData = netRaw.map((row: any) => {
      const ifaces = safeParse<any[]>(row.network_latest, []);
      let totalRx = 0, totalTx = 0;
      for (const i of ifaces) {
        totalRx += Number(i.rx_bytes_sec || 0);
        totalTx += Number(i.tx_bytes_sec || 0);
      }
      return { ts: row.ts, rx: totalRx, tx: totalTx };
    });

    // Per-core CPU data. argMax(cpu_cores, timestamp) keeps the latest blob per
    // bucket; without the GROUP BY this returned every raw row and its full JSON
    // blob, which was the bulk of the payload.
    const coreResult = await clickhouse.query({
      // clickhouse-lint-allow: `interval` is a vetted bucketInterval() literal ("5 MINUTE" / "30 MINUTE" / "1 HOUR"), never user input. CH INTERVAL needs a literal, not a {param}.
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${interval}) AS ts,
          argMax(cpu_cores, timestamp) AS cpu_cores_latest
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
          AND cpu_cores != '' AND cpu_cores != '[]'
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: event.params.id, hours },
      format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
    });
    const coreRaw: any[] = await coreResult.json();
    const cpuCores = coreRaw.map((row: any) => {
      const cores = safeParse<any[]>(row.cpu_cores_latest, []);
      return { ts: row.ts, cores };
    });

    // CPU temperature history. thermal is a JSON-string column (migration 003);
    // argMax keeps the latest blob per bucket, then we JSON.parse out the
    // headline max_cpu_celsius. Same alias-collision guard as above: the result
    // alias is `thermal_latest`, never the `thermal` source column.
    const thermalResult = await clickhouse.query({
      // clickhouse-lint-allow: `interval` is a vetted bucketInterval() literal ("5 MINUTE" / "30 MINUTE" / "1 HOUR"), never user input. CH INTERVAL needs a literal, not a {param}.
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${interval}) AS ts,
          argMax(thermal, timestamp) AS thermal_latest
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
          AND thermal != '' AND thermal != '{}'
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: event.params.id, hours },
      format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
    });
    const thermalRaw: any[] = await thermalResult.json();
    const thermal = thermalRaw.map((row: any) => {
      const t = safeParse<any>(row.thermal_latest, {});
      const maxC = typeof t?.max_cpu_celsius === "number" ? t.max_cpu_celsius : null;
      return { ts: row.ts, maxCpuC: maxC };
    });

    // GPU history. gpu is a JSON-string column (migration 002); argMax keeps the
    // latest blob per bucket, then we extract only the per-device scalars the
    // chart needs (temp / power / VRAM / util). Lean extraction bounds the
    // payload: the raw gpu blob also carries ECC / NVLink / throttle fields.
    const gpuResult = await clickhouse.query({
      // clickhouse-lint-allow: `interval` is a vetted bucketInterval() literal ("5 MINUTE" / "30 MINUTE" / "1 HOUR"), never user input. CH INTERVAL needs a literal, not a {param}.
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${interval}) AS ts,
          argMax(gpu, timestamp) AS gpu_latest
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
          AND gpu != '' AND gpu != '{}'
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: event.params.id, hours },
      format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
    });
    const gpuRaw: any[] = await gpuResult.json();
    const gpu = gpuRaw.map((row: any) => {
      const blob = safeParse<any>(row.gpu_latest, {});
      const gpus = blob?.tier1?.available ? (blob.tier1.gpus ?? []) : [];
      return {
        ts: row.ts,
        gpus: gpus.map((g: any) => ({
          index: g.index,
          name: g.name,
          tempC: typeof g.temp_c === "number" ? g.temp_c : null,
          powerW: typeof g.power_draw_w === "number" ? g.power_draw_w : null,
          vramUsedMib: typeof g.vram_used_mib === "number" ? g.vram_used_mib : null,
          vramTotalMib: typeof g.vram_total_mib === "number" ? g.vram_total_mib : null,
          utilGpu: typeof g.utilization_gpu_percent === "number" ? g.utilization_gpu_percent : null,
        })),
      };
    });

    // Reboot / crash markers. A reboot shows up as uptime_seconds dropping
    // between consecutive snapshots (normal operation only ever increases it).
    // runningDifference over time-ordered rows flags each reset; a >60s drop
    // filters out clock jitter. Its own try/catch: reboot markers are an
    // enhancement and must never take down the whole metrics endpoint.
    let reboots: string[] = [];
    try {
      const rebootResult = await clickhouse.query({
        query: `
          SELECT ts FROM (
            SELECT timestamp AS ts, runningDifference(uptime_seconds) AS d
            FROM (
              SELECT timestamp, uptime_seconds
              FROM snapshots
              WHERE server_id = {server_id:String}
                AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
              ORDER BY timestamp ASC
            )
          )
          WHERE d < -60
          ORDER BY ts ASC
        `,
        query_params: { server_id: event.params.id, hours },
        format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
      });
      const rebootRaw: any[] = await rebootResult.json();
      reboots = rebootRaw.map((r) => r.ts).filter(Boolean);
    } catch (e: any) {
      console.warn("Metrics reboot-detection query failed (non-fatal):", e?.message);
    }

    return json({ hours, data: history, network: networkData, cpuCores, thermal, gpu, reboots });
  } catch (err: any) {
    console.error("Metrics error:", err.message);
    return json({ error: "Failed to get metrics" }, { status: 500 });
  }
};
