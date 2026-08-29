// Audit log writer.
//
// Every API call (success or failure) writes one row to api_audit_log
// (created in PR #1's migration 006). The table has UPDATE/DELETE
// revoked from the application role; we INSERT only.
//
// Resilient by design: an audit-write failure is logged but NEVER
// propagated up. The customer-visible response is unchanged whether
// the audit log row was written or not. The append-only grants mean
// a transient PG outage may cause us to lose audit rows; we accept
// that trade-off vs blocking the customer's request on a logging
// concern.
//
// What gets logged is per-route. The shape is fixed; per-event details
// flow through `metadata`. See spec Part 6 for the exhaustive list of
// what to (and not to) log.

import type { RequestEvent } from "@sveltejs/kit";
import { query } from "@glassmkr/db/pg";
import type { Principal } from "./principal.js";
import { getSourceIp } from "./source-ip.js";

export interface AuditEntry {
  /** The request that's being audited. Used for source_ip, user_agent,
   *  method, path, request_id. */
  event: RequestEvent;
  /** The authenticated principal, or null if auth itself failed. */
  principal: Principal | null;
  /** Logical action: 'create', 'list', 'read', 'update', 'delete',
   *  'rotate', 'auth_failed'. Free-form but limited vocabulary in
   *  practice; documented per route. */
  action: string;
  /** Outcome category. */
  result:
    | "success"
    | "auth_failed"
    | "forbidden"
    | "not_found"
    | "rate_limited"
    | "invalid"
    | "error";
  /** HTTP status code returned to the client. */
  status_code: number;
  /** Resource kind: 'server', 'api_key', etc. Optional for non-resource
   *  events like 'auth_failed'. */
  resource_type?: string;
  /** Resource id, if applicable. */
  resource_id?: string;
  /** Per-event structured context. Avoid logging plaintext secrets,
   *  customer-supplied opaque blobs, or telemetry payloads. Sample
   *  fields: hostname (when creating a server), tags, key prefix on
   *  failed auth, idempotency_key. */
  metadata?: Record<string, unknown>;
  /** Optional override for the request_id. If not provided we read
   *  event.locals.request_id (set by the middleware in PR #3). */
  request_id?: string;
  /** Static MCP tool name. Never place user or host data here. */
  mcp_tool?: string;
  /** Keyed hash of the MCP session id, never the raw session id. */
  mcp_session_hash?: string;
}

/**
 * Convert a SvelteKit RequestEvent to the route-pattern path
 * (e.g. `/api/v1/servers/:id`) by inspecting `event.route.id`. Falls
 * back to the literal pathname if route.id isn't set (shouldn't happen
 * for routes we audit).
 */
function getRoutePattern(event: RequestEvent): string {
  return event.route.id ?? new URL(event.request.url).pathname;
}

/**
 * Write one audit row. Errors are caught and logged; never thrown.
 *
 * Customer principals get logged with their customer_id; cru_key
 * principals also have a customer_id but we record the server_id in
 * metadata so the audit trail has both. Failed-auth events have a
 * null customer_id (we don't know who they were trying to be).
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const customer_id =
      entry.principal && entry.principal.kind !== "cru_key"
        ? entry.principal.customer_id
        : entry.principal?.kind === "cru_key"
          ? entry.principal.customer_id
          : null;

    const key_id =
      entry.principal?.kind === "acct_key"
        ? entry.principal.key_id
        : entry.principal?.kind === "cru_key"
          ? entry.principal.key_id
          : null;

    const user_id =
      entry.principal?.kind === "session"
        ? entry.principal.customer_id
        : entry.principal?.kind === "oauth"
          ? entry.principal.user_id
          : null;

    const oauth_client_id =
      entry.principal?.kind === "oauth" ? entry.principal.client_id : null;
    const oauth_grant_id =
      entry.principal?.kind === "oauth" ? entry.principal.grant_id : null;

    const request_id = entry.request_id
      ?? (entry.event.locals as { request_id?: string }).request_id
      ?? crypto.randomUUID();

    // For cru_key principals we record server_id in metadata too so
    // /api/v1/account/audit can filter by server.
    const enrichedMetadata = { ...(entry.metadata ?? {}) };
    if (entry.principal?.kind === "cru_key") {
      enrichedMetadata.server_id = entry.principal.server_id;
    }

    await query(
      `INSERT INTO api_audit_log
        (customer_id, key_id, user_id, source_ip, user_agent, method, path,
         resource_type, resource_id, action, result, status_code,
         request_id, metadata, oauth_client_id, oauth_grant_id, mcp_tool,
         mcp_session_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18)`,
      [
        customer_id,
        key_id,
        user_id,
        getSourceIp(entry.event),
        entry.event.request.headers.get("user-agent") ?? null,
        entry.event.request.method,
        getRoutePattern(entry.event),
        entry.resource_type ?? null,
        entry.resource_id ?? null,
        entry.action,
        entry.result,
        entry.status_code,
        request_id,
        JSON.stringify(enrichedMetadata),
        oauth_client_id,
        oauth_grant_id,
        entry.mcp_tool ?? null,
        entry.mcp_session_hash ?? null,
      ],
    );
  } catch (err) {
    // Never propagate. Log loudly so monitoring picks up sustained
    // audit failures (those would be a real incident).
    console.error("[audit] write failed:", (err as Error).message);
  }
}
