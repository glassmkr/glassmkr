// Cross-tenant isolation integration test (security audit 2026-05-22,
// §1.8 / catalog T-209, T-307). Hits real PG. Skipped unless
// RUN_INTEGRATION=true (the Integration CI workflow sets it).
//
// Why this exists on top of the mocked authz.test.ts + the static
// bola/scope-enforcement suites:
//   - authz.test.ts mocks @glassmkr/db/pg.query, so it locks in the SQL
//     SHAPE but never runs the query. A JOIN that's syntactically right
//     but semantically wrong (e.g. joining on the wrong column) passes
//     the mock and fails reality.
//   - the static suites prove routes CALL the helpers, not that the
//     helpers actually isolate tenants against a live schema.
//
// This suite seeds two real customers (A and B), each owning a server +
// an active_alert + an alert_channel + a trend_warning, then drives every
// ownership helper with the wrong tenant and asserts a 404 (never a row,
// never a 403 that would confirm existence). It also confirms the
// correct owner still succeeds, so the helpers aren't trivially
// returning 404 for everything.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client as PgClient } from "pg";
import crypto from "node:crypto";
import {
  requireServerOwnership,
  requireChannelOwnership,
  requireAlertOwnership,
  requireTrendWarningOwnership,
} from "../src/lib/server/authz";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "true";

const pgConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "guardian_test",
  user: process.env.DB_USER || "agent",
  password: process.env.DB_PASSWORD || "agent",
};

function expect404(err: unknown) {
  // @sveltejs/kit error() throws an HttpError-shaped object.
  expect((err as any)?.status).toBe(404);
}

interface Tenant {
  customerId: string;
  serverId: string;
  alertId: string | number;
  channelId: number;
  warningId: number;
}

async function seedTenant(pg: PgClient, label: string): Promise<Tenant> {
  const cust = await pg.query(
    `INSERT INTO customers (email) VALUES ($1) RETURNING id`,
    [`xtenant-${label}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}@example.test`],
  );
  const customerId = cust.rows[0].id as string;

  const serverId = "srv_" + crypto.randomBytes(8).toString("hex");
  await pg.query(
    `INSERT INTO servers (id, customer_id, name, api_key_hash, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [serverId, customerId, `xtenant-${label}`, "x"],
  );

  const alert = await pg.query(
    `INSERT INTO active_alerts (server_id, alert_type, severity, title, message)
     VALUES ($1, 'cpu_high', 'warning', 't', 'm') RETURNING id`,
    [serverId],
  );
  const alertId = alert.rows[0].id;

  const channel = await pg.query(
    `INSERT INTO alert_channels (customer_id, channel_type, name, config)
     VALUES ($1, 'telegram', $2, '{}'::jsonb) RETURNING id`,
    [customerId, `xtenant-${label}`],
  );
  const channelId = channel.rows[0].id as number;

  const warning = await pg.query(
    `INSERT INTO trend_warnings
       (server_id, warning_type, resource_identifier, severity, urgency_tier,
        contributing_metrics, evidence_summary)
     VALUES ($1, 'smart_187_growing', 'drive:X', 'medium', 'soon',
             '{}'::jsonb, 'summary') RETURNING id`,
    [serverId],
  );
  // node-postgres returns bigint columns as STRINGS. requireTrendWarning-
  // Ownership guards with Number.isFinite(), so a route wiring this helper
  // MUST coerce its URL param via Number(params.id) or every legitimate
  // request 404s. (No route uses this helper yet; the Doc-4 manual-resolve
  // UI will be the first. Flagged so that wiring coerces correctly.)
  const warningId = Number(warning.rows[0].id);

  return { customerId, serverId, alertId, channelId, warningId };
}

describe.skipIf(!SHOULD_RUN)("cross-tenant isolation (integration)", () => {
  let pg: PgClient;
  let A: Tenant;
  let B: Tenant;

  beforeAll(async () => {
    pg = new PgClient(pgConfig);
    await pg.connect();
    A = await seedTenant(pg, "A");
    B = await seedTenant(pg, "B");
  });

  afterAll(async () => {
    if (pg) {
      // Cascades drop servers/alerts/channels/warnings.
      await pg.query(`DELETE FROM customers WHERE id = ANY($1::uuid[])`, [
        [A.customerId, B.customerId],
      ]);
      await pg.end();
    }
  });

  describe("requireServerOwnership", () => {
    it("A cannot read B's server (404)", async () => {
      await requireServerOwnership(B.serverId, A.customerId).then(
        () => { throw new Error("expected 404"); },
        expect404,
      );
    });
    it("A can read A's own server", async () => {
      const row = await requireServerOwnership(A.serverId, A.customerId);
      expect(row.id).toBe(A.serverId);
    });
  });

  describe("requireChannelOwnership", () => {
    it("A cannot read B's alert channel (404)", async () => {
      await requireChannelOwnership(B.channelId, A.customerId).then(
        () => { throw new Error("expected 404"); },
        expect404,
      );
    });
    it("A can read A's own channel", async () => {
      const row = await requireChannelOwnership(A.channelId, A.customerId);
      expect(Number(row.id)).toBe(A.channelId);
    });
  });

  describe("requireAlertOwnership (JOIN active_alerts -> servers)", () => {
    it("A cannot read B's alert (404)", async () => {
      await requireAlertOwnership(B.alertId, A.customerId).then(
        () => { throw new Error("expected 404"); },
        expect404,
      );
    });
    it("A can read A's own alert", async () => {
      const row = await requireAlertOwnership(A.alertId, A.customerId);
      expect(String(row.server_id)).toBe(A.serverId);
    });
  });

  describe("requireTrendWarningOwnership (JOIN trend_warnings -> servers)", () => {
    it("A cannot read B's trend warning (404)", async () => {
      await requireTrendWarningOwnership(B.warningId, A.customerId).then(
        () => { throw new Error("expected 404"); },
        expect404,
      );
    });
    it("A can read A's own trend warning", async () => {
      const row = await requireTrendWarningOwnership(A.warningId, A.customerId);
      expect(Number(row.id)).toBe(A.warningId);
    });
  });

  it("a non-existent resource is also 404 (no existence oracle)", async () => {
    await requireServerOwnership("srv_doesnotexist", A.customerId).then(
      () => { throw new Error("expected 404"); },
      expect404,
    );
  });
});
