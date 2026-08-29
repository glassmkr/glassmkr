import crypto from "node:crypto";
import { query, withTransaction, type TxClient } from "@glassmkr/db/pg";
import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_IDLE_TTL_SECONDS,
} from "./constants.js";
import { generateOpaqueSecret, hashOAuthValue, pkceS256, timingSafeStringEqual } from "./crypto.js";
import { OAuthRequestError } from "./validation.js";

export interface OAuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

interface LiveGrantFields {
  client_id: string;
  customer_id: string;
  scopes: string[];
  resource: string;
  grant_expires_at: Date;
  grant_revoked_at: Date | null;
  session_epoch_at_issue: Date | null;
  session_epoch: Date | null;
  customer_status: string;
  client_disabled_at: Date | null;
}

interface GrantTokenRow extends LiveGrantFields {
  id: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: Date;
  consumed_at: Date | null;
}

function sameEpoch(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

async function issueTokenPair(
  client: TxClient,
  input: {
    grantId: string;
    scopes: string[];
    familyId?: string;
    parentTokenId?: string;
    absoluteExpiry: Date;
  },
): Promise<OAuthTokenPair> {
  const now = Date.now();
  const accessToken = generateOpaqueSecret("gmk_mcp_at_");
  const refreshToken = generateOpaqueSecret("gmk_mcp_rt_");
  const accessExpiresAt = new Date(now + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000);
  const idleExpiry = new Date(
    Math.min(
      now + OAUTH_REFRESH_IDLE_TTL_SECONDS * 1000,
      input.absoluteExpiry.getTime(),
    ),
  );
  const familyId = input.familyId ?? crypto.randomUUID();

  await client.query(
    `INSERT INTO mcp_oauth_access_tokens (token_hash, grant_id, expires_at)
     VALUES ($1, $2, $3)`,
    [hashOAuthValue("access-token", accessToken), input.grantId, accessExpiresAt],
  );
  await client.query(
    `INSERT INTO mcp_oauth_refresh_tokens
       (token_hash, grant_id, family_id, parent_token_id, expires_at, idle_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hashOAuthValue("refresh-token", refreshToken),
      input.grantId,
      familyId,
      input.parentTokenId ?? null,
      input.absoluteExpiry,
      idleExpiry,
    ],
  );
  await client.query(
    `UPDATE mcp_oauth_grants SET last_used_at = NOW() WHERE id = $1`,
    [input.grantId],
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scopes.join(" "),
  };
}

function assertGrantIsLive(row: LiveGrantFields): void {
  if (
    row.customer_status === "suspended" ||
    row.client_disabled_at !== null ||
    row.grant_revoked_at !== null ||
    row.grant_expires_at.getTime() <= Date.now() ||
    !sameEpoch(row.session_epoch_at_issue, row.session_epoch)
  ) {
    throw new OAuthRequestError("invalid_grant", "grant is invalid or expired");
  }
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  codeVerifier: string;
}): Promise<OAuthTokenPair> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT ac.id, ac.grant_id, ac.redirect_uri, ac.resource,
              ac.code_challenge, ac.expires_at, ac.consumed_at,
              g.client_id, g.customer_id, g.scopes,
              g.expires_at AS grant_expires_at,
              g.revoked_at AS grant_revoked_at,
              g.session_epoch_at_issue,
              c.session_epoch, c.status AS customer_status,
              oc.disabled_at AS client_disabled_at
         FROM mcp_oauth_authorization_codes ac
         JOIN mcp_oauth_grants g ON g.id = ac.grant_id
         JOIN customers c ON c.id = g.customer_id
         JOIN mcp_oauth_clients oc ON oc.client_id = g.client_id
        WHERE ac.code_hash = $1
        FOR UPDATE OF ac, g`,
      [hashOAuthValue("authorization-code", input.code)],
    );
    const row = result.rows[0] as GrantTokenRow | undefined;
    if (
      !row ||
      row.consumed_at !== null ||
      row.expires_at.getTime() <= Date.now() ||
      row.client_id !== input.clientId ||
      row.redirect_uri !== input.redirectUri ||
      row.resource !== input.resource ||
      !timingSafeStringEqual(row.code_challenge, pkceS256(input.codeVerifier))
    ) {
      throw new OAuthRequestError("invalid_grant", "authorization code is invalid or expired");
    }
    assertGrantIsLive(row);
    const consumed = await client.query(
      `UPDATE mcp_oauth_authorization_codes
          SET consumed_at = NOW()
        WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
      [row.id],
    );
    if (consumed.rowCount !== 1) {
      throw new OAuthRequestError("invalid_grant", "authorization code was already used");
    }
    await client.query(
      `UPDATE mcp_oauth_clients SET last_used_at = NOW() WHERE client_id = $1`,
      [row.client_id],
    );
    return issueTokenPair(client, {
      grantId: row.grant_id,
      scopes: row.scopes,
      absoluteExpiry: row.grant_expires_at,
    });
  });
}

interface RefreshTokenRow extends Omit<GrantTokenRow, "redirect_uri" | "code_challenge"> {
  token_id: string;
  family_id: string;
  idle_expires_at: Date;
  token_revoked_at: Date | null;
}

export async function rotateRefreshToken(input: {
  refreshToken: string;
  clientId: string;
  resource: string;
}): Promise<OAuthTokenPair> {
  const outcome = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT rt.id AS token_id, rt.grant_id, rt.family_id, rt.expires_at,
              rt.idle_expires_at, rt.consumed_at,
              rt.revoked_at AS token_revoked_at,
              g.client_id, g.customer_id, g.scopes, g.resource,
              g.expires_at AS grant_expires_at,
              g.revoked_at AS grant_revoked_at,
              g.session_epoch_at_issue,
              c.session_epoch, c.status AS customer_status,
              oc.disabled_at AS client_disabled_at
         FROM mcp_oauth_refresh_tokens rt
         JOIN mcp_oauth_grants g ON g.id = rt.grant_id
         JOIN customers c ON c.id = g.customer_id
         JOIN mcp_oauth_clients oc ON oc.client_id = g.client_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt, g`,
      [hashOAuthValue("refresh-token", input.refreshToken)],
    );
    const row = result.rows[0] as RefreshTokenRow | undefined;
    if (!row) return { kind: "invalid" as const };

    if (row.consumed_at !== null) {
      await client.query(
        `UPDATE mcp_oauth_grants
            SET revoked_at = COALESCE(revoked_at, NOW()),
                revoke_reason = COALESCE(revoke_reason, 'refresh_token_reuse')
          WHERE id = $1`,
        [row.grant_id],
      );
      await client.query(
        `UPDATE mcp_oauth_refresh_tokens
            SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE family_id = $1`,
        [row.family_id],
      );
      return { kind: "reuse" as const };
    }

    if (
      row.token_revoked_at !== null ||
      row.expires_at.getTime() <= Date.now() ||
      row.idle_expires_at.getTime() <= Date.now() ||
      row.client_id !== input.clientId ||
      row.resource !== input.resource
    ) {
      return { kind: "invalid" as const };
    }
    try {
      assertGrantIsLive(row);
    } catch {
      return { kind: "invalid" as const };
    }

    const consumed = await client.query(
      `UPDATE mcp_oauth_refresh_tokens
          SET consumed_at = NOW()
        WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
      [row.token_id],
    );
    if (consumed.rowCount !== 1) return { kind: "invalid" as const };
    const pair = await issueTokenPair(client, {
      grantId: row.grant_id,
      scopes: row.scopes,
      familyId: row.family_id,
      parentTokenId: row.token_id,
      absoluteExpiry: row.expires_at,
    });
    return { kind: "success" as const, pair };
  });

  if (outcome.kind !== "success") {
    throw new OAuthRequestError("invalid_grant", "refresh token is invalid or expired");
  }
  return outcome.pair;
}

export async function revokeOAuthToken(input: {
  token: string;
  clientId: string;
}): Promise<void> {
  const accessHash = hashOAuthValue("access-token", input.token);
  const refreshHash = hashOAuthValue("refresh-token", input.token);
  await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT grant_id FROM mcp_oauth_access_tokens WHERE token_hash = $1
       UNION ALL
       SELECT grant_id FROM mcp_oauth_refresh_tokens WHERE token_hash = $2
       LIMIT 1`,
      [accessHash, refreshHash],
    );
    if (result.rows.length === 0) return;
    const grantId = result.rows[0].grant_id;
    await client.query(
      `UPDATE mcp_oauth_grants
          SET revoked_at = COALESCE(revoked_at, NOW()),
              revoke_reason = COALESCE(revoke_reason, 'token_revoked')
        WHERE id = $1 AND client_id = $2`,
      [grantId, input.clientId],
    );
  });
}
