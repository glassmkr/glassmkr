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

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
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

// GET /auth/callback/github
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
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code: String(code) }),
    });
    const tokens = await tokenRes.json() as Record<string, string>;
    if (!tokens.access_token) {
      return new Response("GitHub token exchange failed", { status: 400 });
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "Glassmkr-Dashboard" },
    });
    const profile = await userRes.json() as { id?: number; email?: string; name?: string; login?: string };

    // Step-up re-auth: match the returning identity to the live session and
    // stamp re-auth, rather than logging in. No email lookup / account create.
    if (isReauthIntent(event)) {
      if (!profile.id) return new Response("GitHub profile missing id", { status: 400 });
      const redirectTo = event.cookies.get("oauth_redirect") || "/settings/keys";
      event.cookies.delete("oauth_redirect", { path: "/", domain: cookieDomain() });
      return completeOAuthReauth(event, "github", String(profile.id), redirectTo);
    }

    if (!profile.id) {
      return new Response("GitHub profile missing id", { status: 400 });
    }

    // Always resolve the email from /user/emails and require a primary, VERIFIED
    // address. profile.email (from GET /user) is not guaranteed verified, so
    // trusting it let an attacker present a victim's unverified address (LB-1).
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "Glassmkr-Dashboard" },
    });
    const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
    const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
    if (!primary) {
      return new Response("GitHub account must have a verified primary email", { status: 400 });
    }

    const resolved = await resolveOAuthCustomer({
      provider: "github",
      providerUserId: String(profile.id),
      email: primary.email,
      name: profile.name || profile.login || "",
      emailVerifiedByProvider: true,
      registrationDisabled: registrationDisabled(),
    });
    if (resolved.status === "registration_disabled") {
      return new Response("Registration is disabled on this instance.", { status: 403 });
    }
    if (resolved.status === "needs_recovery") {
      // The email already belongs to an account we will not silently link (its
      // own email is unverified, so it may be an unclaimed pre-registration).
      // Send the user to prove the mailbox via login/reset instead.
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
    event.cookies.set("gmk_last_login", "github", { httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: cookieDomain(), maxAge: 60 * 60 * 24 * 400 });
    return new Response(null, {
      status: 302,
      headers: {
        location: redirectTo,
        // HOST-ONLY auth cookie (LB-3): authCookieAttrs omits the Domain.
        "set-cookie": `guardian_token=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${authCookieAttrs(event)}`,
      },
    });
  } catch (err: any) {
    console.error("[oauth] GitHub callback error:", err.message);
    return new Response("OAuth error. Please try again.", { status: 500 });
  }
};
