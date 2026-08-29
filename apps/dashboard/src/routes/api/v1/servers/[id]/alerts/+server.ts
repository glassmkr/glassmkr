// scope: read
// tier: free
//
// GET /api/v1/servers/:id/alerts?status=all|active|resolved&limit=N
//
// Refactored 2026-05-14 from `event.locals.customer`-only auth to the
// modern stack via `requireProGatedAuth` with `proGated: false`. The
// endpoint reads the customer's own alert state and is Free per
// Position B; we just need it reachable from acct_key
// callers so CC + customer scripts can debug without going through the
// dashboard.
//
// Surfaced as the highest-leverage item from ALERT_STATE_AUDIT_2026-05-14.md
// (the previous investigation cost an hour of SSH triangulation that one
// curl against this endpoint would have answered).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { requireServerOwnership } from "$lib/server/authz";
import { resolveFix, type ServerLocator } from "$lib/server/alerts/fix-workflow";

export const GET: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "list",
      resource_type: "alert",
      resource_id: event.params.id,
      scopeLevel: "read",
      proGated: false,
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    // BOLA-safe ownership check.
    await requireServerOwnership(event.params.id ?? "", principal.customer_id, "id");

    const status = event.url.searchParams.get("status") || "all";
    const limit = Math.min(parseInt(event.url.searchParams.get("limit") || "50") || 50, 200);

    // FIX-workflow resolution (2026-05-17, file 02-B-minimal wiring):
    // fetch the server's persisted distro/vendor metadata once per request
    // so we can attach a `fix_workflow` field to each alert row in the
    // response. Skipped for count_only queries (which don't return rows
    // at all) and the ClickHouse history path (different row shape).
    // Failure to fetch the server row is non-fatal — alerts return
    // without fix_workflow, client falls back to legacy fix_commands.
    const countOnlyParam = event.url.searchParams.get("count_only") === "true";
    let serverLocator: ServerLocator | null = null;
    if (status !== "all" && !countOnlyParam) {
      try {
        // bola-exempt: requireServerOwnership above already verified the
        // caller owns this server; this SELECT is a read-only lookup of
        // distro/vendor metadata for FIX-workflow variant selection.
        const sres = await query(
          `SELECT os_id, os_id_like, os_version_id, dmi_vendor
           FROM servers WHERE id = $1`,
          [event.params.id]
        );
        if (sres.rows[0]) {
          serverLocator = {
            os_id: sres.rows[0].os_id ?? null,
            os_id_like: sres.rows[0].os_id_like ?? null,
            os_version_id: sres.rows[0].os_version_id ?? null,
            dmi_vendor: sres.rows[0].dmi_vendor ?? null,
          };
        }
      } catch (err) {
        console.warn("[alerts] server-locator fetch failed; alerts will lack fix_workflow:", (err as Error).message);
      }
    }

    function attachFixWorkflow(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
      if (!serverLocator) return rows;
      return rows.map((row) => {
        const alertType = row.alert_type as string | undefined;
        if (!alertType) return row;
        const evidence = typeof row.evidence === "string"
          ? (() => { try { return JSON.parse(row.evidence as string); } catch { return undefined; } })()
          : (row.evidence as Record<string, unknown> | undefined);
        try {
          const fix = resolveFix(alertType, evidence, serverLocator!);
          if (fix) return { ...row, fix_workflow: fix };
        } catch (err) {
          console.warn(`[alerts] resolveFix failed for ${alertType}:`, (err as Error).message);
        }
        return row;
      });
    }

    if (status === "active") {
      const result = await query(
        `SELECT * FROM active_alerts WHERE server_id = $1 AND resolved_at IS NULL
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, first_seen DESC
         LIMIT $2`,
        [event.params.id, limit]
      );
      return json({ alerts: attachFixWorkflow(result.rows) });
    } else if (status === "resolved") {
      // Recently resolved alerts from PG. Shows the last resolution per alert type.
      const daysBack = Math.min(parseInt(event.url.searchParams.get("days") || "90") || 90, 365);
      const countOnly = event.url.searchParams.get("count_only") === "true";

      // count_only is used by the tab label so the UI can show "Resolved (7)"
      // without paying for the full row payload. The real rows still load
      // lazily when the tab is clicked.
      if (countOnly) {
        const countResult = await query(
          `SELECT COUNT(*)::int AS n FROM active_alerts
           WHERE server_id = $1 AND resolved_at IS NOT NULL AND resolved_at > NOW() - $2 * INTERVAL '1 day'`,
          [event.params.id, daysBack]
        );
        return json({ count: countResult.rows[0]?.n ?? 0 });
      }

      const result = await query(
        `SELECT * FROM active_alerts
         WHERE server_id = $1 AND resolved_at IS NOT NULL AND resolved_at > NOW() - $3 * INTERVAL '1 day'
         ORDER BY resolved_at DESC
         LIMIT $2`,
        [event.params.id, limit, daysBack]
      );
      return json({ alerts: attachFixWorkflow(result.rows) });
    } else {
      // Full event log from ClickHouse
      const histResult = await clickhouse.query({
        query: `
          SELECT *
          FROM alert_history
          WHERE server_id = {server_id:String}
          ORDER BY timestamp DESC
          LIMIT {limit:UInt32}
        `,
        query_params: { server_id: event.params.id, limit },
        format: "JSONEachRow",
      });
      const alerts = await histResult.json();
      return json({ alerts });
    }
  } catch (err: any) {
    if (err?.status) throw err;
    console.error("Alert history error:", err.message);
    return json({ error: "Failed to get alerts" }, { status: 500 });
  }
};
