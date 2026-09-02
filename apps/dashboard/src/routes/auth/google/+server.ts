import { redirect } from "@sveltejs/kit";
import { oauthCallbackBase } from "$lib/server/ingest-url";
import { cookieDomain, cookieSecure } from "$lib/server/auth/cookie-domain";
import type { RequestHandler } from "./$types";
import crypto from "node:crypto";
import { safeLocalRedirect } from "$lib/auth/local-redirect.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CALLBACK_BASE = oauthCallbackBase();
// Host-only (no Domain): these ephemeral OAuth cookies must not be settable or
// readable from a sibling origin. A domain-scoped oauth_state could be tossed
// from a sibling to win the callback's CSRF check (round-2 #3).
const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };

// GET /auth/google - Redirect to Google OAuth
export const GET: RequestHandler = async (event) => {
  if (!GOOGLE_CLIENT_ID) {
    return new Response("Google OAuth not configured", { status: 503 });
  }

  // secure follows the deployment (round-3 #1): self-hosted over plain HTTP must
  // not set Secure or the browser drops oauth_state and the callback then 403s.
  const opts = { ...COOKIE_OPTS, secure: cookieSecure(event) };

  const state = crypto.randomBytes(16).toString("hex");
  // Clear any sibling-planted domain-scoped shadow first, so only the host-only
  // value below can satisfy the callback's state check (round-2 #3).
  event.cookies.delete("oauth_state", { path: "/", domain: cookieDomain() });
  event.cookies.set("oauth_state", state, opts);

  // Preserve post-login redirect (e.g., /settings for Pro upgrade)
  const redirectAfter = event.url.searchParams.get("redirect");
  if (redirectAfter) {
    event.cookies.set("oauth_redirect", safeLocalRedirect(redirectAfter), opts);
  }

  // Step-up re-auth (for password-less social accounts confirming a sensitive
  // action) rather than a login. The callback checks this and stamps re-auth
  // instead of minting a session. See lib/server/auth/oauth-reauth.ts.
  if (event.url.searchParams.get("reauth") === "1") {
    event.cookies.set("oauth_intent", "reauth", opts);
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${CALLBACK_BASE}/auth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
