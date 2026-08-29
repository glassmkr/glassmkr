// scope: admin
// DELETE /api/v1/account/keys/{id}
//
// Soft-revoke (sets revoked_at; row stays for audit/forensic). Auth
// returns 401 immediately on any future use of this key.
//
// Auth: session ONLY for revocation. We deliberately
// refuse acct_key revocation by an acct_key principal: an attacker
// who's compromised a key shouldn't be able to revoke other keys (or
// itself, which would be cute but would erase forensic data).
// Operators with only an acct_key handy can use the dashboard.
//
// No re-auth gate on revoke: revocation is recoverable (you can mint
// a new key) and we want it cheap to invoke under pressure.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
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
} from "$lib/server/auth/rate-limit";
import type { Principal } from "$lib/server/auth/principal";

export const DELETE: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "revoke",
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
      action: "revoke",
      result: "auth_failed",
      status_code: 401,
      resource_type: "api_key",
      resource_id: event.params.id,
    });
    throw err;
  }

  // Admin-scope gate (unify-auth Spec B): key revocation is account-
  // level state mutation. Session principals pass through; acct_keys
  // need admin scope. Today this endpoint only accepts session
  // (allow:["session"] above), so this is a no-op preventive check
  // that becomes active if acct_key access is added later.
  try {
    requireScopeLevel(principal, "admin");
  } catch (err) {
    void writeAudit({
      event,
      principal,
      action: "revoke",
      result: "forbidden",
      status_code: 403,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope", required: "admin" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "revoke",
      result: "rate_limited",
      status_code: 429,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    // Phase 4: two revoke modes.
    //   - `?immediate=true` (recommended for compromise / security
    //     incident): set revoked_at=NOW(). Old key dies instantly.
    //     Audit action = `revoke` with `mode=immediate`.
    //   - default / `?immediate=false` (graceful wind-down): set
    //     grace_period_ends_at=NOW()+48h. Key stays valid until cron
    //     reaps it. Audit action = `revoke` with `mode=graceful`.
    // Both modes are BOLA-safe via customer_id, and constrained to
    // non-collector rows via server_id IS NULL.
    const immediate = event.url.searchParams.get("immediate") === "true";
    const GRACE_HOURS = 48;

    const result = await query(
      immediate
        ? `UPDATE account_api_keys
              SET revoked_at = NOW()
            WHERE id = $1 AND customer_id = $2 AND server_id IS NULL
                  AND revoked_at IS NULL
            RETURNING id, name, last_4, grace_period_ends_at`
        : `UPDATE account_api_keys
              SET grace_period_ends_at =
                  COALESCE(grace_period_ends_at,
                           NOW() + ($3 || ' hours')::interval)
            WHERE id = $1 AND customer_id = $2 AND server_id IS NULL
                  AND revoked_at IS NULL
            RETURNING id, name, last_4, grace_period_ends_at`,
      immediate
        ? [event.params.id, principal.customer_id]
        : [event.params.id, principal.customer_id, String(GRACE_HOURS)],
    );
    if (result.rows.length === 0) {
      void writeAudit({
        event,
        principal,
        action: "revoke",
        result: "not_found",
        status_code: 404,
        resource_type: "api_key",
        resource_id: event.params.id,
      });
      return json({ error: "API key not found" }, { status: 404 });
    }

    void writeAudit({
      event,
      principal,
      action: "revoke",
      result: "success",
      status_code: 200,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: {
        name: result.rows[0].name,
        last_4: result.rows[0].last_4,
        mode: immediate ? "immediate" : "graceful",
      },
    });

    // Echo the value actually stored: a graceful re-revoke keeps the earlier
    // grace window via COALESCE, so report the DB row rather than a freshly
    // computed NOW()+48h. (Codex review 2026-06-06, finding B.)
    const graceEndsAt = result.rows[0].grace_period_ends_at;
    return json({
      success: true,
      revoked: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        mode: immediate ? "immediate" : "graceful",
        grace_period_ends_at: graceEndsAt ? new Date(graceEndsAt).toISOString() : null,
      },
    });
  } catch (err: any) {
    console.error("Revoke account key error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "revoke",
      result: "error",
      status_code: 500,
      resource_type: "api_key",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to revoke API key" }, { status: 500 });
  }
};
