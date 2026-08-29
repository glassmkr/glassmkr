// scope: public
// POST /api/v1/webhooks/glitchtip/[token]
//
// Adapter that receives GlitchTip "Generic Webhook" recipient
// callbacks and forwards a clean summary to the operator's Telegram
// chat via the existing notifyOperator() helper.
//
// Why this endpoint exists:
//   GlitchTip's webhook recipient just POSTs JSON to a URL. It does
//   not speak Telegram's bot API. To page the operator's Telegram
//   chat, we need a small translator — that's this file.
//
// Authentication:
//   GlitchTip's generic webhook does NOT support custom headers or
//   HMAC signing in v4 (it sends a Slack-compatible payload to a
//   fixed URL). We authenticate via a URL-path bearer token,
//   matched against GLITCHTIP_WEBHOOK_TOKEN using timing-safe
//   comparison. Generate the token with `openssl rand -hex 32` and
//   put it in both Dashboard's .env and GlitchTip's webhook URL.
//
// Failure policy:
//   ALWAYS return 200 to GlitchTip on a valid token. GlitchTip's
//   retry loop is unhelpful for our use case — if Telegram is down,
//   we'd rather log the issue and move on than have GlitchTip
//   repeatedly fire. Token mismatches return 401 so misconfiguration
//   is visible.

import { json } from "@sveltejs/kit";
import { timingSafeEqual } from "node:crypto";
import { notifyOperator } from "$lib/server/billing/operator-notify";
import { formatTelegramMessage, type SlackLikePayload } from "./formatter";
import type { RequestHandler } from "./$types";

function tokensMatch(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

// tier: free (no Pro-gate; called by GlitchTip server-to-server with
// a shared-secret URL token. Authentication is via GLITCHTIP_WEBHOOK_TOKEN
// + timingSafeEqual, not via customer tier.)
export const POST: RequestHandler = async ({ params, request }) => {
  const expected = process.env.GLITCHTIP_WEBHOOK_TOKEN;

  // Treat the env var being unset as a configuration error rather
  // than as "any token accepted". The endpoint is opt-in.
  if (!expected) {
    console.warn("[glitchtip-webhook] GLITCHTIP_WEBHOOK_TOKEN not set; rejecting");
    return json({ error: "Endpoint disabled" }, { status: 503 });
  }

  const presented = params.token ?? "";
  if (!tokensMatch(presented, expected)) {
    // Don't echo the token in the response. Log enough to debug
    // misconfiguration without giving an attacker an oracle.
    console.warn(
      `[glitchtip-webhook] token mismatch (presented length=${presented.length} expected length=${expected.length})`,
    );
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SlackLikePayload;
  try {
    payload = (await request.json()) as SlackLikePayload;
  } catch (err) {
    // Even bad JSON gets a 200 so GlitchTip doesn't retry forever,
    // but log loudly so a malformed payload doesn't go unnoticed.
    console.error("[glitchtip-webhook] body is not JSON", err);
    return json({ ok: true, note: "body unparseable, logged" });
  }

  const text = formatTelegramMessage(payload);

  // Send asynchronously; we don't want to block the 200 response on
  // Telegram round-trip. notifyOperator already swallows its own
  // errors and logs them, so this is fire-and-forget at the source.
  notifyOperator(text).catch((err) => {
    console.error("[glitchtip-webhook] notifyOperator threw", err);
  });

  return json({ ok: true });
};
