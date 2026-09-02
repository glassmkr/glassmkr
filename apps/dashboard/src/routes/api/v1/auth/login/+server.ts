// scope: public
import { json } from "@sveltejs/kit";
import { cookieDomain, cookieSecure, SIGNED_IN_HINT } from "$lib/server/auth/cookie-domain";
import { getSourceIp } from "$lib/server/auth/source-ip";
import type { RequestHandler } from "./$types";
import { authenticateCustomer, generateToken } from "@glassmkr/auth";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";

const LOGIN_WINDOW_MS = 5 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60,
  path: "/",
  domain: cookieDomain(),
};

// Launch hardening (2026-08-24): getClientAddress() is the nginx loopback
// peer behind the reverse proxy, so keying on it collapsed every client into
// one shared bucket. getSourceIp takes the rightmost X-Forwarded-For entry,
// the only value an external client cannot forge.
function getRequestIp(event: Parameters<typeof getSourceIp>[0]): string {
  return getSourceIp(event);
}

export const POST: RequestHandler = async (event) => {
  try {
    const limit = takeRateLimitHit(`login:${getRequestIp(event)}`, 5, LOGIN_WINDOW_MS);
    if (!limit.allowed) {
      return json({ error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` }, { status: 429 });
    }

    const { email, password } = await event.request.json();
    if (!email || !password) {
      return json({ error: "Email and password are required" }, { status: 400 });
    }

    const customer = await authenticateCustomer(email, password);
    if (!customer) {
      return json({ error: "Invalid email or password" }, { status: 401 });
    }
    if (customer.status === "suspended") {
      return json({ error: "Your account has been suspended." }, { status: 403 });
    }

    const token = generateToken(customer);
    // secure must follow the deployment: hosted is HTTPS, but a self-hosted
    // instance over plain HTTP must NOT set Secure or the browser drops the
    // cookie and login silently stays anonymous (round-3 #1).
    const secure = cookieSecure(event);
    // Clear any sibling-planted domain-scoped guardian_token first, so the
    // host-only cookie below is the ONLY one and cannot be shadowed by an
    // attacker's equal-name cookie (round-2 #2).
    event.cookies.delete("guardian_token", { path: "/", domain: cookieDomain() });
    // HOST-ONLY auth cookie (LB-3): drop the shared Domain so the credential is
    // scoped to app.glassmkr.com and cannot be read by the marketing site.
    event.cookies.set("guardian_token", token, { ...COOKIE_OPTIONS, domain: undefined, secure });
    // Non-sensitive logged-in hint the marketing site reads (keeps the shared
    // Domain from COOKIE_OPTIONS).
    event.cookies.set(SIGNED_IN_HINT, "1", { ...COOKIE_OPTIONS, secure });
    // Remember the method for the "Last used" hint on the login page. Long-lived
    // (survives logout + session expiry) and non-sensitive (just which method).
    event.cookies.set("gmk_last_login", "password", { ...COOKIE_OPTIONS, secure, maxAge: 60 * 60 * 24 * 400 });
    return json({ customer });
  } catch (err: any) {
    console.error("Login error:", err);
    return json({ error: "Login failed" }, { status: 500 });
  }
};
