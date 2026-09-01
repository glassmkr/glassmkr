// scope: public
import { json } from "@sveltejs/kit";
import { cookieDomain, SIGNED_IN_HINT } from "$lib/server/auth/cookie-domain";
import { registrationDisabled } from "$lib/server/auth/registration";
import type { RequestHandler } from "./$types";
import { createCustomer, generateToken } from "@glassmkr/auth";
import { query } from "@glassmkr/db/pg";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { getSourceIp } from "$lib/server/auth/source-ip";
import { enforceIpRateLimit, rateLimitedResponse } from "$lib/server/auth/rate-limit-middleware";
import { sendAlert } from "$lib/server/alerts/telegram";
import { sendVerificationEmail } from "$lib/server/account/email";
import { validatePassword } from "$lib/server/auth/password-policy";

const REGISTER_WINDOW_MS = 60 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
  try {
    // Self-hosters routinely want to create their own account and then close
    // the door. Off by default so the documented first-run flow works.
    if (registrationDisabled()) {
      return json({ error: "Registration is disabled on this instance." }, { status: 403 });
    }
    // G1 (launch hardening, 2026-08-24): signup velocity per IP. The Redis
    // bucket is the real gate (shared across processes, survives restarts);
    // the in-memory hit below stays as the Redis-down backstop. Both key on
    // getSourceIp: getClientAddress() returned the nginx loopback peer for
    // every request, collapsing all signups into one global bucket.
    const ipFail = await enforceIpRateLimit(event, {
      namespaceSuffix: "register",
      capacity: 3,
      refillPerSecond: 3 / 3600,
    });
    if (ipFail) return rateLimitedResponse(ipFail.failure);
    const limit = takeRateLimitHit(`register:${getSourceIp(event)}`, 3, REGISTER_WINDOW_MS);
    if (!limit.allowed) {
      return json({ error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` }, { status: 429 });
    }

    const { email, password, display_name } = await event.request.json();
    if (!email || !password) {
      return json({ error: "Email and password are required" }, { status: 400 });
    }
    const pwError = validatePassword(password);
    if (pwError) {
      return json({ error: pwError }, { status: 400 });
    }

    const { customer, verificationToken } = await createCustomer(email, password, display_name);

    // Record ToS acceptance
    const ip = getSourceIp(event);
    await query(
      `UPDATE customers SET tos_accepted_at = NOW(), tos_version = '2026-04-11', registration_ip = $1 WHERE id = $2`,
      [ip, customer.id]
    ).catch(() => {});

    // Auto-login: set the HOST-ONLY auth cookie (LB-3: no Domain, so the
    // marketing site and sibling subdomains cannot read the credential).
    const token = generateToken(customer);
    // Clear any sibling-planted domain-scoped guardian_token first so the
    // host-only cookie cannot be shadowed by an equal-name cookie (round-2 #2).
    event.cookies.delete("guardian_token", { path: "/", domain: cookieDomain() });
    event.cookies.set("guardian_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    // Non-sensitive logged-in hint the marketing site reads (shared domain).
    event.cookies.set(SIGNED_IN_HINT, "1", { httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: cookieDomain(), maxAge: 7 * 24 * 60 * 60 });
    // "Last used" hint for the login page (long-lived, non-sensitive).
    event.cookies.set("gmk_last_login", "password", { httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: cookieDomain(), maxAge: 60 * 60 * 24 * 400 });

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    sendAlert(`*New signup*: \`${email}\` at ${timestamp}`).catch(() => {});
    // Send the verification email (M10: previously the token was minted but never
    // sent). Send-don't-block: the account already works; verification is optional.
    const verifyBase = process.env.DASHBOARD_PUBLIC_URL || "https://app.glassmkr.com";
    sendVerificationEmail(email, display_name ?? null, `${verifyBase}/verify?token=${verificationToken}`).catch(() => {});

    return json({
      ok: true,
      email: customer.email,
      message: "Account created.",
    }, { status: 201 });
  } catch (err: any) {
    if (err.code === "23505") {
      return json({ error: "Email already registered" }, { status: 409 });
    }
    console.error("Register error:", err);
    return json({ error: "Registration failed" }, { status: 500 });
  }
};
