// scope: internal-secret
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { timingSafeStringEquals } from "$lib/server/auth/keys";
import { reapExpiredMcpOAuthRows, type OAuthReapResult } from "$lib/server/oauth/store";

/**
 * Snapshot retention in days, uniform across every deployment and account.
 *
 * This MUST equal the `TTL toDateTime(timestamp) + toIntervalDay(90)` clause
 * on glassmkr.snapshots in migrations/clickhouse/001_initial.sql. That TTL is
 * the authoritative enforcement (it runs during background merges with no
 * cron required); this endpoint is a supplementary sweep. A self-hosted
 * operator who wants a different window edits the table TTL, which changes
 * both mechanisms' effective outcome for their own instance.
 *
 * Recorded in ground-truth.yaml under `retention`.
 */
const RETENTION_DAYS = 90;

// POST /api/v1/admin/retention - Enforce data retention
// Protected by a shared secret, called by cron
export const POST: RequestHandler = async (event) => {
  // Fail CLOSED: if ADMIN_CRON_SECRET is unset the endpoint is disabled, not
  // open to anyone presenting a hardcoded default. This endpoint runs a
  // fleet-wide ClickHouse DELETE, so a guessable fallback was a real exposure.
  const secret = process.env.ADMIN_CRON_SECRET;
  if (!secret) {
    console.error("[retention] ADMIN_CRON_SECRET not set; refusing to run");
    return json({ error: "Service not configured" }, { status: 503 });
  }
  const authHeader = event.request.headers.get("authorization") ?? "";
  if (!timingSafeStringEquals(authHeader, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get every active server. Retention is uniform post-pivot (2026-08):
    // there is no plan tier to vary it by.
    const result = await query(`
      SELECT c.id AS customer_id, s.id AS server_id
      FROM customers c
      JOIN servers s ON s.customer_id = c.id
      WHERE s.status = 'active'
    `);

    let deletedTotal = 0;

    for (const row of result.rows) {
      // RETENTION_DAYS, not a plan lookup. The old expression was
      // `plan_retention_days || (plan === "pro" ? 90 : 7)`, which would delete
      // a non-pro account's snapshots after 7 days: that directly contradicts
      // the published 90-day retention claim now that every account is on the
      // same footing. The authoritative enforcement is the ClickHouse table
      // TTL (migrations/clickhouse/001_initial.sql); this job is the belt to
      // that TTL's braces, so it must use the same number.
      const retentionDays = RETENTION_DAYS;

      // Delete snapshots older than retention window for this server.
      // Parameterized: server_id and the day count are bound, not interpolated
      // (same INTERVAL {n:UInt32} form the metrics endpoint uses).
      await clickhouse.command({
        query: `
          ALTER TABLE glassmkr.snapshots DELETE
          WHERE server_id = {server_id:String}
            AND timestamp < now() - INTERVAL {days:UInt32} DAY
        `,
        query_params: { server_id: row.server_id, days: retentionDays },
      });

      // Count is approximate since ALTER TABLE DELETE is async in ClickHouse
      deletedTotal++;
    }

    console.log(`[retention] Processed ${result.rows.length} servers`);

    // Reap dead short-lived MCP OAuth rows (authorization requests/codes and
    // expired tokens) in the same periodic job. Best-effort: a failure here must
    // not fail snapshot retention.
    let oauthReap: OAuthReapResult | null = null;
    try {
      oauthReap = await reapExpiredMcpOAuthRows();
      console.log(
        `[retention] MCP OAuth reap: requests=${oauthReap.requests} codes=${oauthReap.codes} access_tokens=${oauthReap.accessTokens} refresh_tokens=${oauthReap.refreshTokens}`,
      );
    } catch (reapErr: any) {
      console.error(`[retention] MCP OAuth reap failed: ${reapErr?.message ?? reapErr}`);
    }

    return json({
      ok: true,
      processed: result.rows.length,
      oauth_reap: oauthReap,
      message: `Retention enforcement complete for ${result.rows.length} servers`,
    });
  } catch (err: any) {
    console.error("Retention enforcement error:", err.message);
    return json({ error: "Retention enforcement failed" }, { status: 500 });
  }
};
