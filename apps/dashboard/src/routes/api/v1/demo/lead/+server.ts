// scope: public
// Lead capture from the public demo's soft CTA. Unauthenticated and
// rate-limited. Persists to demo_leads and notifies the founder inbox.
// Allowlisted in the demo read-only guard (hooks.server.ts) so a
// demo-session visitor can still submit it.
import { json } from "@sveltejs/kit";
import { getSourceIp } from "$lib/server/auth/source-ip";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { sendDemoLeadEmail } from "$lib/server/billing/email";
import { notifyOperator } from "$lib/server/billing/operator-notify";

const WINDOW_MS = 60 * 60 * 1000;
// Basic shape check; we are not verifying deliverability, just rejecting junk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Launch hardening (2026-08-24): getClientAddress() is the nginx loopback
// peer behind the reverse proxy, so keying on it collapsed every client into
// one shared bucket. getSourceIp takes the rightmost X-Forwarded-For entry,
// the only value an external client cannot forge.
function getIp(event: Parameters<typeof getSourceIp>[0]): string {
  return getSourceIp(event);
}

// tier: free (unauthenticated public lead capture from the demo CTA; any
// visitor can submit. Rate-limited 5/hour/IP. No Pro-gate.)
export const POST: RequestHandler = async (event) => {
  // 5 submissions per IP per hour: enough for a typo retry, not a spam vector.
  const limit = takeRateLimitHit(`demo-lead:${getIp(event)}`, 5, WINDOW_MS);
  if (!limit.allowed) {
    return json({ error: `Too many submissions. Try again in ${limit.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: any;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: "Invalid request" }, { status: 400 });
  }

  const email = typeof body?.email === "string" ? body.email.trim().slice(0, 254) : "";
  const wantsCall = body?.wantsCall === true;
  if (!EMAIL_RE.test(email)) {
    return json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const userAgent = event.request.headers.get("user-agent")?.slice(0, 400) ?? null;

  try {
    await query(
      `INSERT INTO demo_leads (email, wants_call, source, user_agent) VALUES ($1, $2, 'demo', $3)`,
      [email.toLowerCase(), wantsCall, userAgent],
    );
  } catch (err: any) {
    console.error("[demo:lead] persist failed:", err.message);
    return json({ error: "Could not save your details. Please try again." }, { status: 500 });
  }

  // Notifications are best-effort: the lead is already saved, so a delivery
  // failure must not fail the request. Email + Telegram (same operator bot
  // used for Stripe pings) so the lead lands wherever Simon is looking.
  sendDemoLeadEmail({ email, wantsCall, userAgent }).catch((err) =>
    console.error("[demo:lead] email failed:", err?.message),
  );
  notifyOperator(
    ["NEW DEMO LEAD", "", `Email: ${email}`, `Wants a call: ${wantsCall ? "yes" : "no"}`].join("\n"),
  ).catch((err) => console.error("[demo:lead] telegram failed:", err?.message));

  return json({ ok: true });
};
