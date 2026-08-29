// Recent-re-authentication gate.
//
// Spec Part 4 + threat A10 (account takeover via session-to-API-key
// escalation): API-key creation is a "step up" operation. Even from a
// fully authenticated web session, the customer must have re-verified
// their password (or 2FA factor) within the last 5 minutes. Without
// this gate, an attacker who steals a session cookie can mint a
// long-lived API key and persist beyond session expiry.
//
// Implementation: customers.last_password_verified_at column (added in
// PR #1's migration 006). The /api/v1/account/verify-password endpoint
// updates this column when the customer re-types their password
// successfully. Sensitive endpoints check the column on entry.
//
// 2FA / WebAuthn re-verification is not yet a thing in Dashboard; when it
// lands it'll write to the same column.

import { error } from "@sveltejs/kit";
import { query } from "@glassmkr/db/pg";

/** Re-auth window. Spec calls for 5 min. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Throws 403 unless the principal's customer has re-verified their
 * password within the last `windowMs` ms. Always returns successfully
 * for non-session principals (acct_key callers can't re-auth in any
 * meaningful way; if a non-session principal hits a step-up endpoint,
 * the route should refuse it via the `allow` list, not via this check).
 *
 * This function performs ONE query. It's small enough to inline at the
 * top of every step-up route. Don't cache the result; the column can
 * change between calls (e.g. operator hitting verify-password mid-flow).
 */
export async function requireRecentReAuth(
  customer_id: string,
  windowMs: number = REAUTH_WINDOW_MS,
): Promise<void> {
  const res = await query(
    `SELECT last_password_verified_at FROM customers WHERE id = $1`,
    [customer_id],
  );
  if (res.rows.length === 0) {
    throw error(404, { message: "Customer not found" } as App.Error);
  }
  const ts: Date | null = res.rows[0].last_password_verified_at ?? null;
  if (ts === null) {
    throw error(403, {
      message:
        "Re-authentication required. Verify your password at " +
        "POST /api/v1/account/verify-password before retrying.",
    } as App.Error);
  }
  const ageMs = Date.now() - new Date(ts).getTime();
  if (ageMs > windowMs) {
    throw error(403, {
      message:
        "Re-authentication expired. Verify your password again at " +
        "POST /api/v1/account/verify-password before retrying.",
    } as App.Error);
  }
}

/**
 * Stamp the customer as having re-verified their password right now.
 * Called from /api/v1/account/verify-password after a successful
 * password check. Idempotent; safe to call repeatedly.
 */
export async function stampReAuth(customer_id: string): Promise<void> {
  await query(
    `UPDATE customers SET last_password_verified_at = NOW() WHERE id = $1`,
    [customer_id],
  );
}
