import type { RequestHandler } from "./$types";
import { oauthCallbackBase } from "$lib/server/ingest-url";
import { cookieDomain, cookieAttrs } from "$lib/server/auth/cookie-domain";
import { getSourceIp } from "$lib/server/auth/source-ip";
import { query } from "@glassmkr/db/pg";
import { registrationDisabled, RegistrationDisabledError } from "$lib/server/auth/registration";
import { generateToken } from "@glassmkr/auth";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { isReauthIntent, completeOAuthReauth } from "$lib/server/auth/oauth-reauth";
import { safeLocalRedirect } from "$lib/auth/local-redirect.js";

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

function mapCustomer(row: any) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified),
    status: row.status || "active",
    plan: row.plan || "free",
  };
}

async function findOrCreateCustomer(provider: string, providerUserId: string, email: string, name: string) {
  const existing = await query(
    "SELECT customer_id FROM oauth_identities WHERE provider = $1 AND provider_user_id = $2",
    [provider, providerUserId]
  );
  if (existing.rows.length > 0) {
    const customer = await query("SELECT id, email, display_name, email_verified, status, plan FROM customers WHERE id = $1", [existing.rows[0].customer_id]);
    return mapCustomer(customer.rows[0]);
  }

  const emailMatch = await query("SELECT id, email, display_name, email_verified, status, plan FROM customers WHERE email = $1", [email]);
  if (emailMatch.rows.length > 0) {
    await query(
      "INSERT INTO oauth_identities (customer_id, provider, provider_user_id, provider_email) VALUES ($1, $2, $3, $4)",
      [emailMatch.rows[0].id, provider, providerUserId, email]
    );
    return mapCustomer(emailMatch.rows[0]);
  }

  // Closing registration must close this path too, or an instance with an
  // OAuth provider configured still hands an account to anyone who can
  // sign in with that provider. Existing identities are matched above and
  // keep working.
  if (registrationDisabled()) {
    throw new RegistrationDisabledError();
  }

  const newCustomer = await query(
    "INSERT INTO customers (email, display_name, email_verified, plan) VALUES ($1, $2, true, 'free') RETURNING id, email, display_name, email_verified, status, plan",
    [email, name]
  );
  await query(
    "INSERT INTO oauth_identities (customer_id, provider, provider_user_id, provider_email) VALUES ($1, $2, $3, $4)",
    [newCustomer.rows[0].id, provider, providerUserId, email]
  );
  console.log(`[oauth] New customer via ${provider}: ${email}`);
  return mapCustomer(newCustomer.rows[0]);
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

    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "Glassmkr-Dashboard" },
      });
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((e) => e.primary && e.verified);
      if (!primary) {
        return new Response("GitHub account must have a verified primary email", { status: 400 });
      }
      email = primary.email;
    }

    const customer = await findOrCreateCustomer("github", String(profile.id), email, profile.name || profile.login || "");
    const jwt = generateToken(customer);
    const redirectTo = safeLocalRedirect(event.cookies.get("oauth_redirect"));
    event.cookies.delete("oauth_redirect", { path: "/", domain: cookieDomain() });
    // "Last used" hint for the login page (long-lived, non-sensitive).
    event.cookies.set("gmk_last_login", "github", { httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: cookieDomain(), maxAge: 60 * 60 * 24 * 400 });
    return new Response(null, {
      status: 302,
      headers: {
        location: redirectTo,
        "set-cookie": `guardian_token=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${cookieAttrs(event)}`,
      },
    });
  } catch (err: any) {
    if (err instanceof RegistrationDisabledError) {
      return new Response("Registration is disabled on this instance.", { status: 403 });
    }
    console.error("[oauth] GitHub callback error:", err.message);
    return new Response("OAuth error. Please try again.", { status: 500 });
  }
};
