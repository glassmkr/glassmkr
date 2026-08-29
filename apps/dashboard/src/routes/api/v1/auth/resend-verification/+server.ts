// scope: session-only
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { query } from "@glassmkr/db/pg";

const RESEND_WINDOW_MS = 60 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
  if (!event.locals.customer) {
    return json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    if (event.locals.customer.emailVerified) {
      return json({ error: "Already verified." }, { status: 400 });
    }

    const limit = takeRateLimitHit(`resend:${event.locals.customer.id}`, 3, RESEND_WINDOW_MS);
    if (!limit.allowed) {
      return json({ error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` }, { status: 429 });
    }

    // Refresh verification token
    const crypto = await import("node:crypto");
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await query(
      `UPDATE customers SET email_verification_token_hash = $1, email_verification_expires_at = $2 WHERE id = $3 RETURNING id`,
      [tokenHash, expiresAt.toISOString(), event.locals.customer.id]
    );
    if (result.rows.length === 0) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    return json({ ok: true, message: "Verification refreshed." });
  } catch (err: any) {
    console.error("Resend verification error:", err);
    return json({ error: "Failed to resend verification" }, { status: 500 });
  }
};
