// scope: admin
// POST /api/v1/account/keys/{id}/rotate
//
// Rotation is a transactional swap: revoke the old key, mint a new
// one with the same name + scopes + expires_at, return the new
// plaintext exactly once.
//
// Step-up required: same as creation (5-min re-auth gate). Per-endpoint
// sub-limit: 10/hr/account.
//
// Auth: session only (same reasoning as DELETE).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query, withTransaction } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_ACCOUNT,
  TIER_KEY_ROTATE,
} from "$lib/server/auth/rate-limit";
import { requireRecentReAuth } from "$lib/server/auth/reauth";
import { generateAccountKey, hashKey, lastFour } from "$lib/server/auth/keys";
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
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, {
      allow: ["session"],
    });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "rotate",
      result: "auth_failed",
      status_code: 401,
      resource_type: "api_key",
      resource_id: event.params.id,
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_ACCOUNT, TIER_KEY_ROTATE],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "rate_limited",
      status_code: 429,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Admin-scope gate (unify-auth Spec B): rotation is account-level
  // key management. Session principals pass through; acct_keys need
  // admin scope. Today this endpoint only accepts session, so the
  // check is preventive — becomes active if acct_key access is added.
  try {
    requireScopeLevel(principal, "admin");
  } catch (err) {
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "forbidden",
      status_code: 403,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope", required: "admin" },
    });
    throw err;
  }

  // 2026-06-21 re-gating: the programmatic API is Free, so key rotation is open
  // to all plans (per-key scope + node cap + rate limits still apply). Recent
  // re-auth is still required below.
  try {
    await requireRecentReAuth(principal.customer_id);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "forbidden",
      status_code: err?.status ?? 403,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { reason: "reauth_required" },
    });
    throw err;
  }

  try {
    // Fetch the existing row (BOLA-constrained); we'll copy name +
    // scope + expires_at to the new row. server_id IS NULL keeps
    // collector rows out of this endpoint (key-separation invariant).
    // The legacy `scopes` jsonb column was dropped by migration 020
    // (unify-auth Spec D) — `scope` is the sole authority.
    const existing = await query(
      `SELECT id, name, scope, expires_at, last_4
         FROM account_api_keys
        WHERE id = $1 AND customer_id = $2
              AND server_id IS NULL
              AND revoked_at IS NULL`,
      [event.params.id, principal.customer_id],
    );
    if (existing.rows.length === 0) {
      void writeAudit({
        event,
        principal,
        action: "rotate",
        result: "not_found",
        status_code: 404,
        resource_type: "api_key",
        resource_id: event.params.id,
      });
      return json({ error: "API key not found" }, { status: 404 });
    }
    const oldRow = existing.rows[0];

    // Mint the new key.
    const key = generateAccountKey("live");
    const keyHash = hashKey(key.raw);

    // Phase 4 graceful rotation: both keys are valid for 48 hours,
    // then the daily expiry cron revokes the old. The old row stays
    // un-revoked (revoked_at NULL) and carries `grace_period_ends_at`
    // + `replaced_by_key_id`; the new row references `replaces_key_id`.
    const GRACE_HOURS = 48;
    const newRow = await withTransaction(async (tx) => {
      const insert = await tx.query(
        `INSERT INTO account_api_keys
          (customer_id, name, prefix, last_4, key_hash, scope, expires_at,
           created_by_user_id, replaces_key_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [
          principal.customer_id,
          oldRow.name,
          key.prefix,
          lastFour(key),
          keyHash,
          oldRow.scope ?? "admin",
          oldRow.expires_at,
          principal.customer_id,
          oldRow.id,
        ],
      );
      const created = insert.rows[0] as { id: string; created_at: Date };
      // Defence in depth: re-assert server_id IS NULL on the old row.
      await tx.query(
        `UPDATE account_api_keys
            SET replaced_by_key_id = $1,
                grace_period_ends_at = NOW() + ($2 || ' hours')::interval
          WHERE id = $3 AND customer_id = $4 AND server_id IS NULL`,
        [created.id, String(GRACE_HOURS), event.params.id, principal.customer_id],
      );
      return created;
    });

    const graceEnds = new Date(Date.now() + GRACE_HOURS * 60 * 60 * 1000);

    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "success",
      status_code: 200,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: {
        old_id: event.params.id,
        old_last_4: oldRow.last_4,
        new_id: newRow.id,
        new_last_4: lastFour(key),
        scope: oldRow.scope ?? "admin",
        grace_period_ends_at: graceEnds.toISOString(),
      },
    });

    return json({
      success: true,
      key: {
        id: newRow.id,
        name: oldRow.name,
        prefix: key.prefix,
        last_4: lastFour(key),
        scope: oldRow.scope ?? "admin",
        created_at: newRow.created_at,
        expires_at: oldRow.expires_at,
        replaces_key_id: oldRow.id,
      },
      api_key: key.raw,
      rotated_at: new Date().toISOString(),
      grace: {
        old_key_id: oldRow.id,
        old_last_4: oldRow.last_4,
        grace_period_ends_at: graceEnds.toISOString(),
        hours_remaining: GRACE_HOURS,
      },
      message:
        "Save this new API key. The old key keeps working for " +
        GRACE_HOURS +
        " hours so you can update your automation, then auto-revokes. " +
        "Use the Revoke action (immediate=true) instead if this is a " +
        "security incident.",
    });
  } catch (err: any) {
    console.error("Rotate account key error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "rotate",
      result: "error",
      status_code: 500,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to rotate API key" }, { status: 500 });
  }
};
