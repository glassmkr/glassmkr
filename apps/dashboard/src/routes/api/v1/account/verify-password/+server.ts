// scope: session-only
// POST /api/v1/account/verify-password
//
// Re-authentication endpoint. Stamps customers.last_password_verified_at
// when the supplied password matches. Used to gate sensitive operations
// like API key creation (spec Part 4 / threat A10).
//
// Auth: session only. We deliberately do NOT accept acct_key / cru_key:
//   - acct_key: there's no plaintext password associated; an attacker
//     who has the key already passes auth, so re-verifying nothing
//     proves nothing.
//   - cru_key: same, plus it's not a customer-level credential.
//
// Rate-limit: per-IP (front-line brute-force protection) + per-account
// (one customer's failed re-auths don't burn the global budget).
// Failed attempts cost a per-account token; sustained failures lock the
// customer out for the refill period. Spec calls this out under A3.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { verifyPassword } from "@glassmkr/auth";
import { requireAuth } from "$lib/server/auth/require";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_ACCOUNT,
} from "$lib/server/auth/rate-limit";
import { stampReAuth } from "$lib/server/auth/reauth";
import type { Principal } from "$lib/server/auth/principal";

export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "verify_password",
      result: "rate_limited",
      status_code: 429,
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    // session only; accepted because the customer
    // is still the same human at the keyboard.
    principal = await requireAuth(event, { allow: ["session"] });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "verify_password",
      result: "auth_failed",
      status_code: 401,
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
      action: "verify_password",
      result: "rate_limited",
      status_code: 429,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    const body = (await event.request.json().catch(() => ({}))) as {
      password?: unknown;
    };
    const password = typeof body.password === "string" ? body.password : null;
    if (password === null || password.length === 0) {
      void writeAudit({
        event,
        principal,
        action: "verify_password",
        result: "invalid",
        status_code: 400,
      });
      return json(
        { error: "validation_failed", message: "password is required" },
        { status: 400 },
      );
    }

    // Look up the customer's password hash. Sessions
    // both have a customer_id; we use that here, not anything from the
    // request body. (BOLA defence at the auth layer.)
    const res = await query(
      `SELECT password_hash FROM customers WHERE id = $1`,
      [principal.customer_id],
    );
    if (res.rows.length === 0 || !res.rows[0].password_hash) {
      // Account exists per the session, but no password is on file
      // (e.g. SSO-only signup). We can't verify what we don't have.
      void writeAudit({
        event,
        principal,
        action: "verify_password",
        result: "forbidden",
        status_code: 403,
        metadata: { reason: "no_password_on_file" },
      });
      return json(
        {
          error: "no_password_on_file",
          message:
            "This account has no password set (SSO-only). Use your SSO " +
            "provider's step-up authentication or set a password first.",
        },
        { status: 403 },
      );
    }

    const ok = await verifyPassword(password, res.rows[0].password_hash);
    if (!ok) {
      void writeAudit({
        event,
        principal,
        action: "verify_password",
        result: "auth_failed",
        status_code: 401,
      });
      // Generic 401; don't leak whether the user exists or whether the
      // password is wrong.
      return json({ error: "Authentication failed" }, { status: 401 });
    }

    await stampReAuth(principal.customer_id);

    void writeAudit({
      event,
      principal,
      action: "verify_password",
      result: "success",
      status_code: 200,
    });

    return json({
      success: true,
      verified_at: new Date().toISOString(),
      // 5 min from now; client can show a countdown / refresh badge.
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (err: any) {
    console.error("verify-password error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "verify_password",
      result: "error",
      status_code: 500,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to verify password" }, { status: 500 });
  }
};
