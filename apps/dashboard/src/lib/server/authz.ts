// Ownership-check helpers used by API routes to enforce BOLA resistance.
//
// Rule of thumb: any route that accepts a resource identifier from the URL
// or request body must verify the authenticated customer owns that resource
// at the SQL level. Don't filter in application code after the fact, and
// don't rely on unguessable IDs as the only defence.
//
// Every helper throws a SvelteKit 404 when ownership fails. 404 (not 403)
// is deliberate: 403 confirms the resource exists, which is itself an
// information leak.

import { error } from "@sveltejs/kit";
import { query } from "@glassmkr/db/pg";

// Callers pass a `columns` string straight into the SELECT list. To keep
// this security helper safe-by-construction (no raw-SQL footgun even if
// a future caller hands in a non-literal), validate that the string is
// a comma-separated list of bare identifiers. Reject anything else.
// Matches:  "id"  |  "id, name"  |  "id,name,created_at"  |  "*"
const COLUMNS_ALLOWED = /^(?:\*|[a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)$/i;

function validateColumns(columns: string): string {
  if (!COLUMNS_ALLOWED.test(columns)) {
    throw new Error(
      `authz: invalid columns expression ${JSON.stringify(columns)}; ` +
        `only a comma-separated list of bare identifiers (or "*") is allowed`,
    );
  }
  return columns;
}

/**
 * Verify the given customer owns a server and return its row.
 * Throws 404 when the row does not exist or belongs to someone else.
 *
 * @param serverId The server id as supplied by the URL / request body.
 * @param customerId The authenticated customer's id (from `event.locals.customer.id`).
 * @param columns Optional comma-separated list of column names to SELECT.
 *        Must be bare identifiers; anything else throws. Defaults to `id`.
 */
export async function requireServerOwnership(
  serverId: string,
  customerId: string,
  columns = "id",
): Promise<Record<string, unknown>> {
  if (!serverId || !customerId) throw error(404, "Not found");
  const cols = validateColumns(columns);
  const res = await query(
    `SELECT ${cols} FROM servers WHERE id = $1 AND customer_id = $2`,
    [serverId, customerId],
  );
  if (res.rows.length === 0) throw error(404, "Not found");
  return res.rows[0] as Record<string, unknown>;
}

/**
 * Verify the given customer owns an alert channel. Throws 404 if not.
 */
export async function requireChannelOwnership(
  channelId: string | number,
  customerId: string,
  columns = "id",
): Promise<Record<string, unknown>> {
  if (!channelId || !customerId) throw error(404, "Not found");
  const cols = validateColumns(columns);
  const res = await query(
    `SELECT ${cols} FROM alert_channels WHERE id = $1 AND customer_id = $2`,
    [channelId, customerId],
  );
  if (res.rows.length === 0) throw error(404, "Not found");
  return res.rows[0] as Record<string, unknown>;
}

/**
 * Verify the given customer owns an active_alerts row via its server.
 * Throws 404 if the alert does not belong to a server they own.
 */
export async function requireAlertOwnership(
  alertId: string | number,
  customerId: string,
): Promise<Record<string, unknown>> {
  if (!alertId || !customerId) throw error(404, "Not found");
  const res = await query(
    `SELECT a.id, a.server_id, a.alert_type
     FROM active_alerts a
     JOIN servers s ON s.id = a.server_id
     WHERE a.id = $1 AND s.customer_id = $2`,
    [alertId, customerId],
  );
  if (res.rows.length === 0) throw error(404, "Not found");
  return res.rows[0] as Record<string, unknown>;
}

/**
 * Verify the given customer owns a trend_warnings row via its server.
 * Throws 404 if not.
 */
export async function requireTrendWarningOwnership(
  warningId: number,
  customerId: string,
): Promise<Record<string, unknown>> {
  if (!Number.isFinite(warningId) || !customerId) throw error(404, "Not found");
  const res = await query(
    `SELECT tw.id
     FROM trend_warnings tw
     JOIN servers s ON s.id = tw.server_id
     WHERE tw.id = $1 AND s.customer_id = $2`,
    [warningId, customerId],
  );
  if (res.rows.length === 0) throw error(404, "Not found");
  return res.rows[0] as Record<string, unknown>;
}
