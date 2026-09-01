import { redirect } from "@sveltejs/kit";
import { oauthCallbackBase } from "$lib/server/ingest-url";
import { cookieDomain } from "$lib/server/auth/cookie-domain";
import type { RequestHandler } from "./$types";
import crypto from "node:crypto";
import { safeLocalRedirect } from "$lib/auth/local-redirect.js";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const CALLBACK_BASE = oauthCallbackBase();
// Host-only (no Domain): these ephemeral OAuth cookies must not be settable or
// readable from a sibling origin. A domain-scoped oauth_state could be tossed
// from a sibling to win the callback's CSRF check (round-2 #3).
const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };

// GET /auth/github - Redirect to GitHub OAuth
export const GET: RequestHandler = async (event) => {
  if (!GITHUB_CLIENT_ID) {
    return new Response("GitHub OAuth not configured", { status: 503 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  // Clear any sibling-planted domain-scoped shadow first, so only the host-only
  // value below can satisfy the callback's state check (round-2 #3).
  event.cookies.delete("oauth_state", { path: "/", domain: cookieDomain() });
  event.cookies.set("oauth_state", state, COOKIE_OPTS);

  const redirectAfter = event.url.searchParams.get("redirect");
  if (redirectAfter) {
    event.cookies.set("oauth_redirect", safeLocalRedirect(redirectAfter), COOKIE_OPTS);
  }

  // Step-up re-auth (for password-less social accounts confirming a sensitive
  // action) rather than a login. The callback checks this and stamps re-auth
  // instead of minting a session. See lib/server/auth/oauth-reauth.ts.
  if (event.url.searchParams.get("reauth") === "1") {
    event.cookies.set("oauth_intent", "reauth", COOKIE_OPTS);
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${CALLBACK_BASE}/auth/callback/github`,
    scope: "user:email",
    state,
  });

  redirect(302, `https://github.com/login/oauth/authorize?${params}`);
};
