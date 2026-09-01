// scope: public
import { json } from "@sveltejs/kit";
import { getSourceIp } from "$lib/server/auth/source-ip";
import type { RequestHandler } from "./$types";
import { resetPasswordByToken } from "@glassmkr/auth";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { validatePassword } from "$lib/server/auth/password-policy";

const WINDOW_MS = 15 * 60 * 1000;

// Launch hardening (2026-08-24): getClientAddress() is the nginx loopback
// peer behind the reverse proxy, so keying on it collapsed every client into
// one shared bucket. getSourceIp takes the rightmost X-Forwarded-For entry,
// the only value an external client cannot forge.
function getRequestIp(event: Parameters<typeof getSourceIp>[0]): string {
  return getSourceIp(event);
}

export const POST: RequestHandler = async (event) => {
  // Per-IP throttle to stop token brute-forcing (tokens are 256-bit, but the
  // limit is cheap insurance).
  const limit = takeRateLimitHit(`reset:${getRequestIp(event)}`, 10, WINDOW_MS);
  if (!limit.allowed) {
    return json(
      { error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` },
      { status: 429 },
    );
  }

  let token: unknown, password: unknown;
  try {
    ({ token, password } = await event.request.json());
  } catch {
    return json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  }
  if (typeof token !== "string" || token.length === 0) {
    return json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  }
  const pwError = validatePassword(password);
  if (pwError) {
    return json({ error: pwError }, { status: 400 });
  }

  try {
    // validatePassword above rejected any non-string, so this is safe.
    const result = await resetPasswordByToken(token, password as string);
    if (result.status === "success") {
      // Deliberately do NOT create a session here: the user logs in fresh with
      // the new password. Keeps the reset endpoint out of the session-issuing
      // path and confirms the new credential works.
      return json({ ok: true });
    }
    return json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[auth] reset-password error:", err);
    return json({ error: "Password reset failed" }, { status: 500 });
  }
};
