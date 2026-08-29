import crypto from "node:crypto";
import { query, withTransaction, type TxClient } from "@glassmkr/db/pg";
import type { OAuthScope } from "$lib/server/auth/principal.js";
import {
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS,
  OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS,
  getMcpPublicOrigin,
} from "./constants.js";
import { generateOpaqueSecret, hashOAuthValue, timingSafeBufferEqual } from "./crypto.js";
import { OAuthRequestError, appendOAuthRedirectParams } from "./validation.js";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  isVerified: boolean;
}

export interface AuthorizationRequestInput {
  customerId: string;
  clientId: string;
  redirectUri: string;
  scopes: OAuthScope[];
  state: string | null;
  resource: string;
  codeChallenge: string;
}

export interface AuthorizationRequestView {
  id: string;
  csrf: string;
  clientName: string;
  clientId: string;
  isVerified: boolean;
  scopes: OAuthScope[];
  redirectHost: string;
  expiresAt: Date;
}

interface AuthorizationRequestRow {
  id: string;
  customer_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scopes: OAuthScope[];
  state: string | null;
  resource: string;
  code_challenge: string;
  csrf_hash: Buffer;
  expires_at: Date;
  consumed_at: Date | null;
  session_epoch: Date | null;
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const result = await query(
    `SELECT client_id, client_name, redirect_uris, is_verified
       FROM mcp_oauth_clients
      WHERE client_id = $1 AND disabled_at IS NULL`,
    [clientId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    isVerified: Boolean(row.is_verified),
  };
}

export async function registerOAuthClient(input: {
  clientName: string;
  redirectUris: string[];
}): Promise<OAuthClient> {
  const clientId = crypto.randomUUID();
  const result = await query(
    `INSERT INTO mcp_oauth_clients
       (client_id, client_name, redirect_uris, token_endpoint_auth_method)
     VALUES ($1, $2, $3, 'none')
     RETURNING client_id, client_name, redirect_uris, is_verified`,
    [clientId, input.clientName, input.redirectUris],
  );
  const row = result.rows[0];
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    isVerified: Boolean(row.is_verified),
  };
}

export async function createAuthorizationRequest(
  input: AuthorizationRequestInput,
): Promise<AuthorizationRequestView> {
  const csrf = generateOpaqueSecret("gmk_mcp_csrf_");
  const expiresAt = new Date(Date.now() + OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS * 1000);
  const result = await query(
    `INSERT INTO mcp_oauth_authorization_requests
       (customer_id, client_id, redirect_uri, scopes, state, resource,
        code_challenge, csrf_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.customerId,
      input.clientId,
      input.redirectUri,
      input.scopes,
      input.state,
      input.resource,
      input.codeChallenge,
      hashOAuthValue("authorization-csrf", csrf),
      expiresAt,
    ],
  );
  const client = await getOAuthClient(input.clientId);
  if (!client) throw new OAuthRequestError("invalid_request", "client is unavailable");
  return {
    id: result.rows[0].id,
    csrf,
    clientName: client.clientName,
    clientId: client.clientId,
    isVerified: client.isVerified,
    scopes: input.scopes,
    redirectHost: new URL(input.redirectUri).host,
    expiresAt,
  };
}

async function loadAuthorizationRequest(
  client: TxClient,
  requestId: string,
): Promise<AuthorizationRequestRow | null> {
  const result = await client.query(
    `SELECT ar.*, c.session_epoch, oc.client_name
       FROM mcp_oauth_authorization_requests ar
       JOIN customers c ON c.id = ar.customer_id
       JOIN mcp_oauth_clients oc ON oc.client_id = ar.client_id
      WHERE ar.id = $1 AND oc.disabled_at IS NULL
      FOR UPDATE OF ar`,
    [requestId],
  );
  return result.rows[0] ?? null;
}

function validateAuthorizationRequest(
  row: AuthorizationRequestRow | null,
  customerId: string,
  csrf: string,
): asserts row is AuthorizationRequestRow {
  const csrfHash = hashOAuthValue("authorization-csrf", csrf);
  if (
    !row ||
    row.customer_id !== customerId ||
    row.consumed_at !== null ||
    row.expires_at.getTime() <= Date.now() ||
    !timingSafeBufferEqual(row.csrf_hash, csrfHash)
  ) {
    throw new OAuthRequestError("invalid_request", "authorization request is invalid or expired");
  }
}

export async function approveAuthorizationRequest(input: {
  requestId: string;
  customerId: string;
  csrf: string;
}): Promise<string> {
  return withTransaction(async (client) => {
    const row = await loadAuthorizationRequest(client, input.requestId);
    validateAuthorizationRequest(row, input.customerId, input.csrf);

    const consumed = await client.query(
      `UPDATE mcp_oauth_authorization_requests
          SET consumed_at = NOW()
        WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
      [row.id],
    );
    if (consumed.rowCount !== 1) {
      throw new OAuthRequestError("invalid_request", "authorization request was already used");
    }

    const grantExpiresAt = new Date(Date.now() + OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS * 1000);
    const grant = await client.query(
      `INSERT INTO mcp_oauth_grants
         (customer_id, client_id, scopes, resource, session_epoch_at_issue, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        row.customer_id,
        row.client_id,
        row.scopes,
        row.resource,
        row.session_epoch,
        grantExpiresAt,
      ],
    );

    const code = generateOpaqueSecret("gmk_mcp_code_");
    const codeExpiresAt = new Date(Date.now() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000);
    await client.query(
      `INSERT INTO mcp_oauth_authorization_codes
         (code_hash, grant_id, redirect_uri, resource, code_challenge, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        hashOAuthValue("authorization-code", code),
        grant.rows[0].id,
        row.redirect_uri,
        row.resource,
        row.code_challenge,
        codeExpiresAt,
      ],
    );

    // iss (RFC 9207): identify the issuer in the authorization response so the
    // client can detect a mix-up / substituted authorization server.
    return appendOAuthRedirectParams(row.redirect_uri, {
      code,
      state: row.state,
      iss: getMcpPublicOrigin(),
    });
  });
}

export async function denyAuthorizationRequest(input: {
  requestId: string;
  customerId: string;
  csrf: string;
}): Promise<string> {
  return withTransaction(async (client) => {
    const row = await loadAuthorizationRequest(client, input.requestId);
    validateAuthorizationRequest(row, input.customerId, input.csrf);
    await client.query(
      `UPDATE mcp_oauth_authorization_requests
          SET consumed_at = NOW()
        WHERE id = $1 AND consumed_at IS NULL`,
      [row.id],
    );
    return appendOAuthRedirectParams(row.redirect_uri, {
      error: "access_denied",
      state: row.state,
      iss: getMcpPublicOrigin(),
    });
  });
}

export interface GrantListItem {
  id: string;
  clientName: string;
  clientId: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function listCustomerMcpGrants(customerId: string): Promise<GrantListItem[]> {
  const result = await query(
    `SELECT g.id, g.client_id, c.client_name, g.scopes, g.created_at,
            g.last_used_at, g.expires_at, g.revoked_at
       FROM mcp_oauth_grants g
       JOIN mcp_oauth_clients c ON c.client_id = g.client_id
      WHERE g.customer_id = $1
      ORDER BY g.created_at DESC
      LIMIT 100`,
    [customerId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    clientName: row.client_name,
    clientId: row.client_id,
    scopes: row.scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeCustomerMcpGrant(
  customerId: string,
  grantId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE mcp_oauth_grants
        SET revoked_at = COALESCE(revoked_at, NOW()),
            revoke_reason = COALESCE(revoke_reason, 'customer_revoked')
      WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL
    RETURNING id`,
    [grantId, customerId],
  );
  return result.rowCount === 1;
}

export interface OAuthReapResult {
  requests: number;
  codes: number;
  accessTokens: number;
  refreshTokens: number;
}

/**
 * Delete dead short-lived OAuth rows. These grow without bound otherwise: every
 * consent-screen load inserts an authorization_request, and each grant issues
 * codes + tokens. Grants themselves are retained (the durable, audit-relevant
 * record). Only leaf rows past a grace window are removed, so a request still
 * mid-flight or a token still inside its refresh window is never touched. Called
 * from the retention cron; safe to run repeatedly.
 */
export async function reapExpiredMcpOAuthRows(): Promise<OAuthReapResult> {
  const requests = await query(
    `DELETE FROM mcp_oauth_authorization_requests WHERE expires_at < NOW() - INTERVAL '1 hour'`,
  );
  const codes = await query(
    `DELETE FROM mcp_oauth_authorization_codes WHERE expires_at < NOW() - INTERVAL '1 hour'`,
  );
  const accessTokens = await query(
    `DELETE FROM mcp_oauth_access_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`,
  );
  const refreshTokens = await query(
    `DELETE FROM mcp_oauth_refresh_tokens
      WHERE idle_expires_at < NOW() - INTERVAL '7 days'
         OR expires_at < NOW() - INTERVAL '1 day'
         OR revoked_at < NOW() - INTERVAL '30 days'`,
  );
  return {
    requests: requests.rowCount ?? 0,
    codes: codes.rowCount ?? 0,
    accessTokens: accessTokens.rowCount ?? 0,
    refreshTokens: refreshTokens.rowCount ?? 0,
  };
}
