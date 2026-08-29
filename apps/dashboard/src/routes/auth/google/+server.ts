import { redirect } from "@sveltejs/kit";
import { oauthCallbackBase } from "$lib/server/ingest-url";
import { cookieDomain } from "$lib/server/auth/cookie-domain";
import type { RequestHandler } from "./$types";
import crypto from "node:crypto";
import { safeLocalRedirect } from "$lib/auth/local-redirect.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CALLBACK_BASE = oauthCallbackBase();
const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/", domain: cookieDomain() };

// GET /auth/google - Redirect to Google OAuth
export const GET: RequestHandler = async (event) => {
  if (!GOOGLE_CLIENT_ID) {
    return new Response("Google OAuth not configured", { status: 503 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  event.cookies.set("oauth_state", state, COOKIE_OPTS);

  // Preserve post-login redirect (e.g., /settings for Pro upgrade)
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
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${CALLBACK_BASE}/auth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
