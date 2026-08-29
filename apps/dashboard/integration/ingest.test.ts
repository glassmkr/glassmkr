// Integration test for the ingest endpoint. Hits real PG + ClickHouse.
// Skipped unless RUN_INTEGRATION=true (CI workflow sets it).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client as PgClient } from "pg";
import { createClient as createCh } from "@clickhouse/client";
import { POST } from "../src/routes/api/v1/ingest/+server";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { healthySnapshot } from "../src/lib/server/alerts/__tests__/helpers";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "true";

const pgConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "guardian_test",
  user: process.env.DB_USER || "agent",
  password: process.env.DB_PASSWORD || "agent",
};
const CH_URL = process.env.CLICKHOUSE_URL || "http://127.0.0.1:8123";

describe.skipIf(!SHOULD_RUN)("ingest endpoint (integration)", () => {
  let pg: PgClient;
  let ch: ReturnType<typeof createCh>;
  let serverId: string;
  let customerId: string;
  let apiKey: string;

  beforeAll(async () => {
    pg = new PgClient(pgConfig);
    await pg.connect();
    ch = createCh({ url: CH_URL, database: "glassmkr" });

    // Seed: customer + server with a known API key
    const cust = await pg.query(
      `INSERT INTO customers (email) VALUES ($1) RETURNING id`,
      [`integration-${Date.now()}@example.test`]
    );
    customerId = cust.rows[0].id;

    serverId = "srv_" + crypto.randomBytes(8).toString("hex");
    apiKey = "col_" + crypto.randomBytes(24).toString("hex");
    const apiKeyHash = await bcrypt.hash(apiKey, 10);
    await pg.query(
      `INSERT INTO servers (id, customer_id, name, api_key_hash, status) VALUES ($1, $2, $3, $4, 'active')`,
      [serverId, customerId, "test-server", apiKeyHash]
    );
  });

  afterAll(async () => {
    if (pg) {
      await pg.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
      await pg.end();
    }
    if (ch) await ch.close();
  });

  it("rejects requests without a bearer token", async () => {
    const req = new Request("http://localhost/api/v1/ingest", { method: "POST" });
    const res = await POST({ request: req } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it("accepts an authenticated snapshot and persists rows in PG + CH", async () => {
    const snap = { ...healthySnapshot(), collector_version: "0.6.1" };
    const req = new Request("http://localhost/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
    const res = await POST({ request: req } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);

    const snapsRes = await ch.query({
      query: "SELECT count() AS c FROM snapshots WHERE server_id = {sid:String}",
      query_params: { sid: serverId },
      format: "JSONEachRow",
    });
    const rows = await snapsRes.json<{ c: string }>();
    expect(Number(rows[0].c)).toBeGreaterThan(0);
  });

  it("stamps resolution_reason='auto_decay_24h_since_last_seen' on event-type alerts with last_seen older than 24h", async () => {
    // Use a FRESH server (distinct id + api key) for this test. The
    // ingest endpoint enforces "max 1 ingest per minute per server.id"
    // via an in-memory map in
    // apps/dashboard/src/routes/api/v1/ingest/+server.ts (the
    // `lastIngest` Map + isRateLimited() check). The previous test
    // in this file already used the suite-level serverId, so without
    // a fresh server this test would 429 on its own ingest. The new
    // server pattern mirrors beforeAll exactly, scoped to this case.
    const otherServerId = "srv_" + crypto.randomBytes(8).toString("hex");
    const otherApiKey = "col_" + crypto.randomBytes(24).toString("hex");
    const otherApiKeyHash = await bcrypt.hash(otherApiKey, 10);
    await pg.query(
      `INSERT INTO servers (id, customer_id, name, api_key_hash, status) VALUES ($1, $2, $3, $4, 'active')`,
      [otherServerId, customerId, "test-server-resolution", otherApiKeyHash]
    );

    // Seed an event-type alert with last_seen > 24h ago so the
    // pre-existing last_seen-based resolver in ingest.+server.ts
    // qualifies. The new resolution_reason stamp is the regression
    // guard for the 2026-05-14 finding (three fleet boxes resolved
    // overnight with NULL reason). Pair with PR #66's uptime-based
    // path: BOTH paths now set a distinguishable reason.
    await pg.query(
      `INSERT INTO active_alerts
        (server_id, alert_type, severity, title, message, evidence, first_seen, last_seen)
       VALUES ($1, 'unexpected_reboot', 'critical', 'Server rebooted unexpectedly',
               'integration test seed', '{}'::jsonb,
               NOW() - INTERVAL '25 hours', NOW() - INTERVAL '25 hours')`,
      [otherServerId]
    );

    // Run an ingest cycle with a healthy snapshot (uptime > 600 so the
    // unexpected_reboot rule itself does NOT re-fire, leaving the
    // 24h-since-last_seen path as the only resolver that can match).
    const snap = { ...healthySnapshot(), collector_version: "0.9.4" };
    snap.system.uptime_seconds = 3600; // 1h uptime; < 24h means PR #66 path skips
    const req = new Request("http://localhost/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${otherApiKey}`, "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
    const res = await POST({ request: req } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);

    const alertRow = await pg.query(
      `SELECT resolved_at, resolution_reason FROM active_alerts
       WHERE server_id = $1 AND alert_type = 'unexpected_reboot'
       ORDER BY first_seen DESC LIMIT 1`,
      [otherServerId]
    );
    expect(alertRow.rows[0].resolved_at).not.toBeNull();
    expect(alertRow.rows[0].resolution_reason).toBe("auto_decay_24h_since_last_seen");
  });
});
