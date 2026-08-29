// scope: public
import { json } from "@sveltejs/kit";
import { getSourceIp } from "$lib/server/auth/source-ip";
import type { RequestHandler } from "./$types";
import { createPasswordResetToken } from "@glassmkr/auth";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { sendPasswordReset } from "$lib/server/account/email";

const WINDOW_MS = 15 * 60 * 1000;
const DASHBOARD_HOST = process.env.DASHBOARD_PUBLIC_URL || "https://app.glassmkr.com";

// Always the same body: the endpoint must never reveal whether an account
// exists for the given email (no enumeration oracle).
const GENERIC = {
  message: "If an account exists for that email, we've sent a password reset link.",
};

// Launch hardening (2026-08-24): getClientAddress() is the nginx loopback
// peer behind the reverse proxy, so keying on it collapsed every client into
// one shared bucket. getSourceIp takes the rightmost X-Forwarded-For entry,
// the only value an external client cannot forge.
function getRequestIp(event: Parameters<typeof getSourceIp>[0]): string {
  return getSourceIp(event);
}

export const POST: RequestHandler = async (event) => {
  // Per-IP throttle blunts both enumeration and using this to email-bomb a
  // victim. A 429 here does not leak account existence.
  const limit = takeRateLimitHit(`forgot:${getRequestIp(event)}`, 5, WINDOW_MS);
  if (!limit.allowed) {
    return json(
      { error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` },
      { status: 429 },
    );
  }

  let email: unknown;
  try {
    ({ email } = await event.request.json());
  } catch {
    return json(GENERIC);
  }
  if (typeof email !== "string" || email.length === 0) {
    return json(GENERIC);
  }

  try {
    const reset = await createPasswordResetToken(email);
    if (reset) {
      const url = `${DASHBOARD_HOST}/reset-password?token=${encodeURIComponent(reset.token)}`;
      // Fire-and-forget: do NOT await the send. Awaiting the Resend round-trip
      // only on the existing-account branch made the response measurably slower
      // for real accounts, a timing existence oracle despite the identical
      // GENERIC body. Not awaiting keeps both branches ~constant-time.
      void sendPasswordReset(reset.customer.email, reset.customer.displayName, url).catch((err) => {
        console.error("[auth] forgot-password send failed:", err);
      });
    }
  } catch (err) {
    // Log server-side but still return the generic body (never leak existence
    // or internal errors to the caller).
    console.error("[auth] forgot-password error:", err);
  }
  return json(GENERIC);
};
