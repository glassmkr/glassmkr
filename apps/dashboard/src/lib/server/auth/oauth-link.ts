// OAuth identity resolution + safe account linking.
//
// LB-1 (Grok + Codex security review, 2026-09-01). The old inline
// findOrCreateCustomer (duplicated in the GitHub and Google callbacks) linked an
// OAuth identity onto ANY existing customer row that shared the email, then
// issued a session for it. Two takeover paths followed:
//
//   1. An attacker whose provider account reports the victim's email (GitHub in
//      particular did not require a verified email) signed in and was logged
//      into the victim's account.
//   2. An attacker pre-registered the victim's email by password (verification
//      is optional), and the victim's later verified OAuth login was silently
//      attached to the attacker's account.
//
// The rule here (policy chosen by the maintainer, "pragmatic"): auto-link or
// auto-create ONLY when the provider verified the incoming email AND, for a
// link, the existing account is already email-verified. Any other match is
// refused and routed to recovery (sign in / reset password to prove the
// mailbox), never silently linked or duplicated. Linking and creation are
// transactional with deterministic conflict handling, and a missing provider id
// is rejected rather than turned into an "undefined" identity.

import { query, withTransaction } from "@glassmkr/db/pg";
import { mapCustomer } from "@glassmkr/auth";
import type { CustomerPayload } from "@glassmkr/db/types";

const CUSTOMER_COLS =
  "id, email, display_name, email_verified, status, plan, is_demo, session_epoch";

export type OAuthResolution =
  | { status: "ok"; customer: CustomerPayload }
  // The email belongs to an existing account we will not auto-link (existing
  // account unverified, or the provider did not verify the incoming email). The
  // caller sends the user to recover/verify rather than logging them in.
  | { status: "needs_recovery" }
  // Would have to create a new account, but registration is closed on this
  // instance. Caller maps this to its RegistrationDisabledError response.
  | { status: "registration_disabled" }
  // Missing/blank provider id or email: never mint an "undefined" identity.
  | { status: "invalid" };

export interface OAuthResolveInput {
  provider: string;
  providerUserId: string;
  email: string;
  name: string;
  // True only when the provider itself vouched for the email: Google's
  // verified_email, or a GitHub primary+verified address from /user/emails.
  emailVerifiedByProvider: boolean;
  registrationDisabled: boolean;
}

// Thrown inside the create transaction when the provider identity turns out to
// belong to a DIFFERENT customer (a concurrent flow won the race). Throwing
// rolls back the customer we just created so it is not left as an orphan; the
// caller then retries and step 1 resolves to the identity's real owner.
class OAuthIdentityRace extends Error {}

export async function resolveOAuthCustomer(
  input: OAuthResolveInput,
  attempt = 0,
): Promise<OAuthResolution> {
  const provider = input.provider;
  const providerUserId = (input.providerUserId ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const name = input.name ?? "";

  // Reject a missing/blank provider id or email. `String(undefined)` upstream
  // yields the literal "undefined"; guard against that too, so a broken token
  // exchange cannot create or match an "undefined" identity.
  if (!providerUserId || providerUserId === "undefined" || !email) {
    return { status: "invalid" };
  }

  // 1. An existing link by (provider, provider_user_id) always wins and keeps
  //    working, regardless of verification state.
  const linked = await query(
    `SELECT ${CUSTOMER_COLS} FROM customers c
       JOIN oauth_identities o ON o.customer_id = c.id
      WHERE o.provider = $1 AND o.provider_user_id = $2`,
    [provider, providerUserId],
  );
  if (linked.rows.length > 0) {
    return { status: "ok", customer: mapCustomer(linked.rows[0]) };
  }

  // 2. An existing account with this email. Link ONLY when both sides are
  //    verified: the provider vouched for the incoming email AND the local
  //    account already proved its own email. Anything else is refused.
  const emailMatch = await query(
    `SELECT ${CUSTOMER_COLS} FROM customers WHERE lower(email) = $1`,
    [email],
  );
  if (emailMatch.rows.length > 0) {
    const existing = emailMatch.rows[0];
    if (!input.emailVerifiedByProvider || !existing.email_verified) {
      return { status: "needs_recovery" };
    }
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO oauth_identities (customer_id, provider, provider_user_id, provider_email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, provider_user_id) DO NOTHING`,
        [existing.id, provider, providerUserId, email],
      );
    });
    return { status: "ok", customer: mapCustomer(existing) };
  }

  // 3. No existing account. Create one only from a provider-verified email (so a
  //    freshly created account is legitimately email_verified); an unverified
  //    provider email must not mint a verified account.
  if (!input.emailVerifiedByProvider) {
    return { status: "needs_recovery" };
  }
  if (input.registrationDisabled) {
    return { status: "registration_disabled" };
  }

  const outcome = await withTransaction<{ row: any } | { recovery: true }>(async (client) => {
    const ins = await client.query(
      `INSERT INTO customers (email, display_name, email_verified, plan)
       VALUES ($1, $2, true, 'free')
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING ${CUSTOMER_COLS}`,
      [email, name || null],
    );
    let row = ins.rows[0];
    if (!row) {
      // Lost a race: another request created this email between the step-2
      // lookup and this INSERT. The racing row may be an attacker
      // pre-registration, so apply the SAME verified-both-sides rule as the link
      // path (finding #1) - only link to an ALREADY email-verified account,
      // otherwise refuse and route to recovery. A freshly INSERTed row above is
      // verified by construction and skips this check.
      const again = await client.query(
        `SELECT ${CUSTOMER_COLS} FROM customers WHERE lower(email) = $1`,
        [email],
      );
      row = again.rows[0];
      if (!row || !row.email_verified) {
        return { recovery: true };
      }
    }
    const linkIns = await client.query(
      `INSERT INTO oauth_identities (customer_id, provider, provider_user_id, provider_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_user_id) DO NOTHING
       RETURNING customer_id`,
      [row.id, provider, providerUserId, email],
    );
    if (linkIns.rowCount === 0) {
      // The provider identity is already owned by a DIFFERENT customer (a
      // concurrent flow won). Roll back so a freshly created customer is not left
      // orphaned (verified, no password, no identity, unreachable) - round-3 #3.
      throw new OAuthIdentityRace();
    }
    return { row };
  }).catch((e) => {
    if (e instanceof OAuthIdentityRace) return { raced: true as const };
    throw e;
  });

  if ("raced" in outcome) {
    // Retry once: step 1 now finds the identity and resolves to its real owner.
    if (attempt >= 1) return { status: "needs_recovery" };
    return resolveOAuthCustomer(input, attempt + 1);
  }
  if ("recovery" in outcome) return { status: "needs_recovery" };
  return { status: "ok", customer: mapCustomer(outcome.row) };
}
