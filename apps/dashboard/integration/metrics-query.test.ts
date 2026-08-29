// Metrics-endpoint ClickHouse query integration test. Hits real ClickHouse.
// Skipped unless RUN_INTEGRATION=true (the Integration CI workflow sets it).
//
// Why this exists: #268 added per-bucket argMax queries to the metrics
// endpoint and aliased a result to the SAME name as the source column. The
// cpu_cores query additionally filters `WHERE cpu_cores != ''`, so on the
// prod ClickHouse (26.3) the analyzer bound that WHERE identifier to the
// SELECT alias `argMax(cpu_cores, timestamp) AS cpu_cores`, raising
// "Aggregate function ... is found in WHERE" (ILLEGAL_AGGREGATION, code 184)
// and 500ing the endpoint fleet-wide. ClickHouse 24.8 (the version CI used
// to run) binds to the source column instead and never reproduced it, which
// is why #268 shipped green-but-broken. The CI ClickHouse image is now
// pinned to 26.3.x to match prod, so this is a real known-bad fixture: the
// colliding-alias form must be rejected, the `*_latest` aliases must work.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createCh } from "@clickhouse/client";
import crypto from "node:crypto";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "true";
const CH_URL = process.env.CLICKHOUSE_URL || "http://127.0.0.1:8123";

const serverId = "srv_metrics_" + crypto.randomBytes(6).toString("hex");
const INTERVAL = "5 MINUTE"; // mirrors metrics/+server.ts for a <=24h window

function nowUtcClickhouse(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

describe.skipIf(!SHOULD_RUN)("metrics endpoint ClickHouse queries (integration)", () => {
  let ch: ReturnType<typeof createCh>;

  beforeAll(async () => {
    ch = createCh({ url: CH_URL, database: "glassmkr" });
    await ch.insert({
      table: "snapshots",
      values: [
        {
          server_id: serverId,
          timestamp: nowUtcClickhouse(),
          cpu_user_percent: 10,
          cpu_system_percent: 3,
          cpu_iowait_percent: 1,
          ram_used_mb: 4096,
          ram_total_mb: 64000,
          swap_used_mb: 0,
          load_1m: 0.5,
          network: JSON.stringify([{ interface: "eno1", rx_bytes_sec: 1000, tx_bytes_sec: 500 }]),
          cpu_cores: JSON.stringify([{ core: 0, user_percent: 10 }, { core: 1, user_percent: 12 }]),
        },
      ],
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    if (ch) {
      await ch.command({
        query: `ALTER TABLE glassmkr.snapshots DELETE WHERE server_id = {sid:String}`,
        query_params: { sid: serverId },
      }).catch(() => {});
      await ch.close();
    }
  });

  it("the colliding-alias cpu_cores query (AS cpu_cores + WHERE cpu_cores, the #268 bug) is rejected", async () => {
    // On the prod-matched ClickHouse (26.x) the WHERE identifier resolves to
    // the aggregate alias -> ILLEGAL_AGGREGATION. This is the exact prod 500.
    const broken = ch.query({
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${INTERVAL}) AS ts,
          argMax(cpu_cores, timestamp) AS cpu_cores
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
          AND cpu_cores != '' AND cpu_cores != '[]'
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: serverId, hours: 24 },
      format: "JSONEachRow",
    }).then((r) => r.json());
    await expect(broken).rejects.toBeDefined();
  });

  it("the fixed cpu_cores query (AS cpu_cores_latest) succeeds and returns the latest blob", async () => {
    const rows = await ch.query({
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${INTERVAL}) AS ts,
          argMax(cpu_cores, timestamp) AS cpu_cores_latest
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
          AND cpu_cores != '' AND cpu_cores != '[]'
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: serverId, hours: 24 },
      format: "JSONEachRow",
    }).then((r) => r.json<any>());
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.parse(rows[0].cpu_cores_latest).length).toBe(2);
  });

  it("the fixed network query (AS network_latest) succeeds and returns the latest blob", async () => {
    const rows = await ch.query({
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${INTERVAL}) AS ts,
          argMax(network, timestamp) AS network_latest
        FROM snapshots
        WHERE server_id = {server_id:String}
          AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: { server_id: serverId, hours: 24 },
      format: "JSONEachRow",
    }).then((r) => r.json<any>());
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.parse(rows[0].network_latest)[0].interface).toBe("eno1");
  });
});
