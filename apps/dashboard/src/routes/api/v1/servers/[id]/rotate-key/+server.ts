// scope: admin
// POST /api/v1/servers/{id}/rotate-key
//
// Atomically rotate this server's collector key. After rotation:
//   - The OLD key (whether legacy col_* or new gmk_cru_*) is invalid.
//   - The NEW key is gmk_cru_live_* in the new format with HMAC+pepper
//     storage in account_api_keys (linked via server_id).
//   - servers.api_key_hash is cleared to NULL if it was a legacy bcrypt.
//
// Operator updates the agent's dashboard.api_key on the host with the
// returned plaintext. Until the agent is restarted with the new key,
// telemetry pushes 401.
//
// PR #6 (cutover): rotate-key now always issues the new format. There
// is no way to mint a new col_* key after this PR lands. Existing
// col_* keys remain valid (in servers.api_key_hash) until each is
// rotated.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { withTransaction } from "@glassmkr/db/pg";
import { lockServerRowTx } from "$lib/server/services/server-admin-actions";
import { requireAuth } from "$lib/server/auth/require";
import { requireProTierForAcctKey, requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_KEY,
  TIER_PER_ACCOUNT,
  TIER_KEY_ROTATE,
} from "$lib/server/auth/rate-limit";
import { requireServerOwnership } from "$lib/server/authz";
import { generateCollectorKey, hashKey, lastFour } from "$lib/server/auth/keys";
import type { Principal } from "$lib/server/auth/principal";

export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "rotate",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, {
      allow: ["session", "acct_key"],
    });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "rotate",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
      resource_id: event.params.id,
    });
    throw err;
  }

  // Pro-tier gate for acct_key callers. Dashboard "Reset collector
  // key" continues to work for Free sessions because operating their
  // 3 free servers may legitimately require a rotation.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: collector-key rotation requires `write`.
  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT, TIER_KEY_ROTATE],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    const serverId = event.params.id ?? "";
    await requireServerOwnership(serverId, principal.customer_id, "id");

    const newKey = generateCollectorKey("live");
    const newKeyHash = hashKey(newKey.raw);

    // Atomic transaction (pinned to one connection via withTransaction):
    //   1. Revoke any existing cru key rows for this server.
    //   2. Insert the new cru key.
    //   3. Clear servers.api_key_hash (in case the server had a legacy
    //      col_* key; this completes the cutover for this server).
    let oldLast4: string | null = null;
    await withTransaction(async (tx) => {
      // Lock the PARENT row before touching this server's key rows. The MCP
      // confirm path locks servers first and then reads the key row to build a
      // resource version; this route used to do the reverse, which is a
      // deadlock between the two and, until one blocks, lets MCP version
      // against a key row this transaction is midway through replacing.
      await lockServerRowTx(tx, principal.customer_id, serverId);
      const oldRows = await tx.query(
        `SELECT id, last_4 FROM account_api_keys
          WHERE server_id = $1 AND revoked_at IS NULL`,
        [serverId],
      );
      if (oldRows.rows.length > 0) {
        oldLast4 = (oldRows.rows[0] as { last_4: string }).last_4;
        await tx.query(
          `UPDATE account_api_keys SET revoked_at = NOW()
            WHERE server_id = $1 AND revoked_at IS NULL`,
          [serverId],
        );
      }
      // The legacy `scopes` jsonb column was dropped by migration 020
      // (unify-auth Spec D); the cru_key rotate path used to write `[]`.
      await tx.query(
        `INSERT INTO account_api_keys
          (customer_id, name, prefix, last_4, key_hash,
           server_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          principal.customer_id,
          serverId,
          newKey.prefix,
          lastFour(newKey),
          newKeyHash,
          serverId,
          principal.kind === "acct_key" ? null : principal.customer_id,
        ],
      );
      await tx.query(
        `UPDATE servers SET api_key_hash = NULL
          WHERE id = $1 AND customer_id = $2`,
        [serverId, principal.customer_id],
      );
    });

    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "success",
      status_code: 200,
      resource_type: "server",
      resource_id: serverId,
      metadata: {
        old_key_last_4: oldLast4,
        new_key_last_4: lastFour(newKey),
        new_key_format: "gmk_cru_live_v1",
      },
    });

    return json({
      success: true,
      server: { id: serverId },
      collector_key: newKey.raw,
      // Alias matching POST /servers (which returns the key as `api_key`),
      // so both endpoints expose the collector key under both names.
      api_key: newKey.raw,
      rotated_at: new Date().toISOString(),
      message:
        "Save this collector key. The old key is now invalid and will not " +
        "be shown again. Update the agent's dashboard.api_key in " +
        "/etc/glassmkr/crucible.yaml on this server (legacy installs: " +
        "/etc/glassmkr/collector.yaml; the agent reads either), then " +
        "restart the glassmkr-crucible service.",
    });
  } catch (err: any) {
    if (err?.status === 404) {
      void writeAudit({
        event,
        principal,
        action: "rotate",
        result: "not_found",
        status_code: 404,
        resource_type: "server",
        resource_id: event.params.id,
      });
      throw err;
    }
    console.error("Rotate key error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "error",
      status_code: 500,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to rotate collector key" }, { status: 500 });
  }
};
