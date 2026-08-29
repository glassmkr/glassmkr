// scope: write
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { sendTestEmail } from "$lib/server/alerts/email";
import { safeFetch, SsrfBlockedError } from "$lib/server/net/safe-fetch";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { take, TIER_CHANNEL_TEST, TIER_WEBHOOK_SEND } from "$lib/server/auth/rate-limit";

// tier: free
// POST /api/v1/channels/:id/test — send a test notification. Open to Free on
// all auth paths (2026-06-21 re-gating: the programmatic API is Free).
export const POST: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "create",
      resource_type: "channel",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  // G3 (launch hardening, 2026-08-24): this endpoint is an on-demand
  // outbound-request primitive toward a customer-chosen URL; the generic
  // per-key tier (1000 burst) is far too generous for that. 10/hour per
  // account, plus the shared per-account outbound budget.
  const testBudget = await take(TIER_CHANNEL_TEST, principal.customer_id);
  if (!testBudget.allowed) {
    return json(
      { error: "Channel test limit reached (10 per hour).", retry_after_seconds: testBudget.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(testBudget.retryAfterSeconds) } },
    );
  }
  const sendBudget = await take(TIER_WEBHOOK_SEND, principal.customer_id);
  if (!sendBudget.allowed) {
    return json(
      { error: "Outbound notification budget exceeded.", retry_after_seconds: sendBudget.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(sendBudget.retryAfterSeconds) } },
    );
  }

  try {
    const result = await query(
      `SELECT * FROM alert_channels WHERE id = $1 AND customer_id = $2`,
      [event.params.id, principal.customer_id]
    );

    if (result.rows.length === 0) {
      return json({ error: "Channel not found" }, { status: 404 });
    }

    const channel = result.rows[0];
    let success = false;
    let error = "";

    if (channel.channel_type === "telegram") {
      let { chat_id } = channel.config;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        success = false;
        error = "Telegram bot not configured on server";
      } else {
        try {
          // If user entered a @username, try to resolve it via getChat
          if (chat_id && (chat_id.startsWith("@") || !/^-?\d+$/.test(chat_id))) {
            const username = chat_id.startsWith("@") ? chat_id : `@${chat_id}`;
            const chatInfo = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: username }),
              signal: AbortSignal.timeout(10000),
            });
            if (chatInfo.ok) {
              const chatData = await chatInfo.json() as { result?: { id?: number } };
              if (chatData.result?.id) {
                // Update the stored config with the resolved numeric ID.
                // bola-exempt: channel.id was loaded by the customer-
                // scoped SELECT at the top of this handler (line 13:
                // WHERE id = $1 AND customer_id = $2).
                const numericId = String(chatData.result.id);
                await query(
                  `UPDATE alert_channels SET config = jsonb_set(config, '{chat_id}', $1::jsonb) WHERE id = $2`,
                  [JSON.stringify(numericId), channel.id]
                );
                chat_id = numericId;
              }
            } else {
              success = false;
              error = `Could not find Telegram user ${username}. Make sure the user has messaged @glassmkr_bot first.`;
            }
          }

          if (!error) {
            const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id,
                text: "\u2705 <b>Test alert from Dashboard</b>\n\nIf you see this, your Telegram channel is working.",
                parse_mode: "HTML",
              }),
              signal: AbortSignal.timeout(10000),
            });
            success = r.ok;
            if (!success) {
              error = r.status === 400 ? "Invalid chat ID. The user must message @glassmkr_bot first (/start)." :
                      r.status === 403 ? "Bot was blocked. Unblock @glassmkr_bot on Telegram." :
                      `Telegram API error (${r.status})`;
            }
          }
        } catch (e: any) {
          error = e.message;
        }
      }
    } else if (channel.channel_type === "slack") {
      // safeFetch (SSRF guard): webhook_url is customer-controlled and the
      // Slack host is not validated at create time, so this must go through
      // the same SSRF guard as the discord/webhook branch below (the raw
      // fetch here was a blind-SSRF status oracle for internal hosts).
      const { webhook_url } = channel.config;
      try {
        const r = await safeFetch(webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Test alert from Dashboard. If you see this, your Slack channel is working." }),
          signal: AbortSignal.timeout(10000),
        });
        success = r.ok;
        if (!success) error = `Slack webhook returned ${r.status}`;
      } catch (e: any) {
        error = e instanceof SsrfBlockedError
          ? "Webhook URL is not allowed (it resolves to a private or internal address)"
          : e.message;
      }
    } else if (channel.channel_type === "email") {
      const result = await sendTestEmail(channel.config.email);
      success = result.success;
      error = result.error || "";
    } else if (channel.channel_type === "discord" || channel.channel_type === "webhook") {
      const { webhook_url } = channel.config;
      if (!webhook_url) {
        error = "No webhook_url configured";
      } else {
        // safeFetch (SSRF guard): webhook_url is customer-controlled.
        const body = channel.channel_type === "discord"
          ? { content: "Test alert from Glassmkr. If you see this, your Discord channel is working." }
          : { event: "glassmkr.test", message: "Test alert from Glassmkr. If you see this, your webhook is working." };
        try {
          const r = await safeFetch(webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
          });
          success = r.ok;
          if (!success) error = `Webhook returned ${r.status}`;
        } catch (e: any) {
          error = e instanceof SsrfBlockedError
            ? "Webhook URL is not allowed (it resolves to a private or internal address)"
            : e.message;
        }
      }
    } else if (channel.channel_type === "pagerduty") {
      const routing_key = channel.config.routing_key || channel.config.integration_key;
      if (!routing_key) {
        error = "No routing_key configured";
      } else {
        // Trigger then immediately resolve the same dedup_key, so a test never
        // leaves a lingering incident / pages the on-call.
        const pd = (event_action: string, extra: Record<string, unknown> = {}) =>
          fetch("https://events.pagerduty.com/v2/enqueue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ routing_key, event_action, dedup_key: "glassmkr/test", ...extra }),
            signal: AbortSignal.timeout(10000),
          });
        try {
          const t = await pd("trigger", { payload: { summary: "Glassmkr test event (auto-resolves)", severity: "info", source: "glassmkr-dashboard" } });
          await pd("resolve");
          success = t.ok;
          if (!success) error = `PagerDuty returned ${t.status}`;
        } catch (e: any) {
          error = e.message;
        }
      }
    }

    return json({ success, error: error || undefined });
  } catch (err: any) {
    console.error("Test channel error:", err.message);
    return json({ error: "Failed to test channel" }, { status: 500 });
  }
};
