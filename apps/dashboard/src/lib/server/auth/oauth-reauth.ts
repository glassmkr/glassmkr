// OAuth step-up re-authentication.
//
// The re-auth gate (reauth.ts) that guards API-key creation/rotation only knew
// how to re-verify a PASSWORD. Accounts created purely via GitHub/Google have
// no password_hash, so they could never satisfy the gate and were locked out of
// creating API keys entirely. This adds an equivalent step-up for them: bounce
// back through the OAuth provider and, if the returning identity is the SAME
// account that is already logged in, stamp last_password_verified_at just as a
// successful password re-verify would.
//
// Assurance: this proves the logged-in human still controls a provider account
// linked to their customer (an attacker holding only a stolen guardian_token,
// without the provider session, cannot complete it). It never creates or links
// an account and never mints a session token: login stays a separate flow.

import type { RequestEvent } from "@sveltejs/kit";
import { cookieDomain } from "$lib/server/auth/cookie-domain";
import { query } from "@glassmkr/db/pg";
import { stampReAuth } from "./reauth";
import { safeLocalRedirect } from "$lib/auth/local-redirect.js";

const COOKIE_CLEAR = { path: "/", domain: cookieDomain() } as const;

// The initiator sets oauth_intent=reauth when called with ?reauth=1, marking
// this callback as a step-up rather than a login.
export function isReauthIntent(event: RequestEvent): boolean {
  return event.cookies.get("oauth_intent") === "reauth";
}

// Only same-origin absolute paths are honored, so a tampered oauth_redirect
// cookie cannot turn the callback into an open redirect.
function redirectWith(target: string, marker: string): Response {
  const base = safeLocalRedirect(target, "/settings/keys");
  const sep = base.includes("?") ? "&" : "?";
  return new Response(null, { status: 302, headers: { location: `${base}${sep}reauth=${marker}` } });
}

// Complete a step-up re-auth. The provider identity must resolve to the SAME
// customer as the current session; on match, stamp the re-auth timestamp so the
// gate passes for the next 5 minutes. Returns a 302 to `redirectTo` with a
// ?reauth=ok|mismatch marker (or /login if there is no live session). Consumes
// the oauth_intent cookie.
export async function completeOAuthReauth(
  event: RequestEvent,
  provider: string,
  providerUserId: string,
  redirectTo: string,
): Promise<Response> {
  event.cookies.delete("oauth_intent", COOKIE_CLEAR);

  const sessionCustomer = event.locals.customer;
  if (!sessionCustomer) {
    // A step-up only makes sense for a live session; send to login.
    return new Response(null, { status: 302, headers: { location: "/login" } });
  }

  const row = await query(
    "SELECT customer_id FROM oauth_identities WHERE provider = $1 AND provider_user_id = $2",
    [provider, providerUserId],
  );
  const linkedId: string | undefined = row.rows[0]?.customer_id;

  if (!linkedId || linkedId !== sessionCustomer.id) {
    // The provider account signed in with is not the one linked to this
    // session. Do NOT stamp: a different identity must not satisfy the gate.
    return redirectWith(redirectTo, "mismatch");
  }

  await stampReAuth(sessionCustomer.id);
  return redirectWith(redirectTo, "ok");
}
