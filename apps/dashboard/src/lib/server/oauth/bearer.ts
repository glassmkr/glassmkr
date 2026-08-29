import { query } from "@glassmkr/db/pg";
import type { OAuthPrincipal, OAuthScope } from "$lib/server/auth/principal.js";
import { getMcpResourceUrl } from "./constants.js";
import { hashOAuthValue } from "./crypto.js";
import { allowedOriginsForRedirects } from "./validation.js";

const ACCESS_TOKEN_PREFIX = "gmk_mcp_at_";

function sameEpoch(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function scopeLevel(scopes: ReadonlySet<OAuthScope>): "read" | "write" | "admin" {
  if (scopes.has("glassmkr:admin")) return "admin";
  if (scopes.has("glassmkr:write")) return "write";
  return "read";
}

export async function authenticateMcpBearer(request: Request): Promise<OAuthPrincipal | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith(ACCESS_TOKEN_PREFIX) || token.length > 256) return null;

  const result = await query(
    `SELECT at.id AS token_id, at.expires_at AS token_expires_at,
            at.revoked_at AS token_revoked_at,
            g.id AS grant_id, g.customer_id, g.client_id, g.scopes,
            g.resource, g.expires_at AS grant_expires_at,
            g.revoked_at AS grant_revoked_at, g.session_epoch_at_issue,
            c.email, c.plan, c.status, c.session_epoch,
            oc.client_name, oc.redirect_uris, oc.disabled_at AS client_disabled_at
       FROM mcp_oauth_access_tokens at
       JOIN mcp_oauth_grants g ON g.id = at.grant_id
       JOIN customers c ON c.id = g.customer_id
       JOIN mcp_oauth_clients oc ON oc.client_id = g.client_id
      WHERE at.token_hash = $1`,
    [hashOAuthValue("access-token", token)],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (
    row.token_revoked_at !== null ||
    row.token_expires_at.getTime() <= Date.now() ||
    row.grant_revoked_at !== null ||
    row.grant_expires_at.getTime() <= Date.now() ||
    row.client_disabled_at !== null ||
    row.status === "suspended" ||
    row.resource !== getMcpResourceUrl() ||
    !sameEpoch(row.session_epoch_at_issue, row.session_epoch)
  ) {
    return null;
  }

  const scopes = new Set<OAuthScope>(row.scopes);
  if (!scopes.has("glassmkr:read")) return null;

  void query(
    `UPDATE mcp_oauth_access_tokens
        SET last_used_at = NOW()
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
    [row.token_id],
  ).catch((error) => {
    console.error("[mcp-oauth] last-used update failed:", (error as Error).message);
  });
  void query(
    `UPDATE mcp_oauth_grants
        SET last_used_at = NOW()
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
    [row.grant_id],
  ).catch((error) => {
    console.error("[mcp-oauth] grant last-used update failed:", (error as Error).message);
  });

  return {
    kind: "oauth",
    customer_id: row.customer_id,
    user_id: row.customer_id,
    client_id: row.client_id,
    client_name: row.client_name,
    grant_id: row.grant_id,
    token_id: row.token_id,
    scopes,
    scope: scopeLevel(scopes),
    plan: row.plan,
    resource: row.resource,
    allowed_origins: allowedOriginsForRedirects(row.redirect_uris),
  };
}

export function hasMcpScope(principal: OAuthPrincipal, scope: OAuthScope): boolean {
  if (principal.scopes.has("glassmkr:admin")) return true;
  if (scope === "glassmkr:read" && principal.scopes.has("glassmkr:write")) return true;
  return principal.scopes.has(scope);
}
