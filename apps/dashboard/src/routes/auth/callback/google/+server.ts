import type { RequestHandler } from "./$types";
import { oauthCallbackBase } from "$lib/server/ingest-url";
import { cookieDomain, authCookieAttrs, SIGNED_IN_HINT } from "$lib/server/auth/cookie-domain";
import { getSourceIp } from "$lib/server/auth/source-ip";
import { registrationDisabled } from "$lib/server/auth/registration";
import { generateToken } from "@glassmkr/auth";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { isReauthIntent, completeOAuthReauth } from "$lib/server/auth/oauth-reauth";
import { safeLocalRedirect } from "$lib/auth/local-redirect.js";
import { resolveOAuthCustomer } from "$lib/server/auth/oauth-link";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const CALLBACK_BASE = oauthCallbackBase();
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const OAUTH_WINDOW_MS = 5 * 60 * 1000;

// Launch hardening (2026-08-24): getClientAddress() is the nginx loopback
// peer behind the reverse proxy, so keying on it collapsed every client into
// one shared bucket. getSourceIp takes the rightmost X-Forwarded-For entry,
// the only value an external client cannot forge.
function getRequestIp(event: Parameters<typeof getSourceIp>[0]): string {
  return getSourceIp(event);
}

// GET /auth/callback/google
export const GET: RequestHandler = async (event) => {
  const limit = takeRateLimitHit(`oauth:${getRequestIp(event)}`, 10, OAUTH_WINDOW_MS);
  if (!limit.allowed) {
    return new Response(`Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`, { status: 429 });
  }

  const code = event.url.searchParams.get("code");
  const state = event.url.searchParams.get("state");
  const savedState = event.cookies.get("oauth_state");

  if (!state || state !== savedState) {
    return new Response("Invalid state parameter", { status: 403 });
  }
  event.cookies.delete("oauth_state", { path: "/", domain: cookieDomain() });

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${CALLBACK_BASE}/auth/callback/google`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json() as Record<string, string>;
    if (!tokens.access_token) {
      return new Response("Google token exchange failed", { status: 400 });
    }

    // Get user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json() as { id?: string; email?: string; verified_email?: boolean; name?: string };

    // Step-up re-auth: match the returning identity to the live session and
    // stamp re-auth, rather than logging in. No email lookup / account create.
    if (isReauthIntent(event)) {
      if (!profile.id) return new Response("Google profile missing id", { status: 400 });
      const redirectTo = event.cookies.get("oauth_redirect") || "/settings/keys";
      event.cookies.delete("oauth_redirect", { path: "/", domain: cookieDomain() });
      return completeOAuthReauth(event, "google", String(profile.id), redirectTo);
    }

    if (!profile.id) {
      return new Response("Google profile missing id", { status: 400 });
    }
    if (!profile.email || !profile.verified_email) {
      return new Response("Google account must have a verified email", { status: 400 });
    }

    const resolved = await resolveOAuthCustomer({
      provider: "google",
      providerUserId: String(profile.id),
      email: profile.email,
      name: profile.name || "",
      emailVerifiedByProvider: true,
      registrationDisabled: registrationDisabled(),
    });
    if (resolved.status === "registration_disabled") {
      return new Response("Registration is disabled on this instance.", { status: 403 });
    }
    if (resolved.status === "needs_recovery") {
      // Email already belongs to an account we will not silently link; route to
      // recovery so the user proves the mailbox (LB-1).
      return new Response(null, { status: 302, headers: { location: "/login?error=account_exists" } });
    }
    if (resolved.status !== "ok") {
      return new Response("OAuth error. Please try again.", { status: 400 });
    }
    const jwt = generateToken(resolved.customer);
    const redirectTo = safeLocalRedirect(event.cookies.get("oauth_redirect"));
    event.cookies.delete("oauth_redirect", { path: "/", domain: cookieDomain() });
    // Clear any sibling-planted domain-scoped guardian_token so the host-only
    // cookie below cannot be shadowed by an equal-name cookie (round-2 #2).
    event.cookies.delete("guardian_token", { path: "/", domain: cookieDomain() });
    // Non-sensitive logged-in hint the marketing site reads (shared domain).
    event.cookies.set(SIGNED_IN_HINT, "1", { httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: cookieDomain(), maxAge: COOKIE_MAX_AGE });
    // "Last used" hint for the login page (long-lived, non-sensitive).
    event.cookies.set("gmk_last_login", "google", { httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: cookieDomain(), maxAge: 60 * 60 * 24 * 400 });
    return new Response(null, {
      status: 302,
      headers: {
        location: redirectTo,
        // HOST-ONLY auth cookie (LB-3): authCookieAttrs omits the Domain.
        "set-cookie": `guardian_token=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${authCookieAttrs(event)}`,
      },
    });
  } catch (err: any) {
    console.error("[oauth] Google callback error:", err.message);
    return new Response("OAuth error. Please try again.", { status: 500 });
  }
};
