// Trend warning notification dispatch.
//
// Routes a single trend warning to all of a customer's enabled alert
// channels (email, telegram, slack). Mirrors the alerts dispatcher but uses
// the narration payload and trend-warning urgency mapping.
//
// Spec: 07-trend-warnings-spec-v2.md, Notification Integration.

import { Resend } from "resend";
import { DEFAULT_PRIORITIES } from "$lib/alerts/priority";
import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { safeFetch, SsrfBlockedError } from "$lib/server/net/safe-fetch";
import { serverDetailUrl } from "$lib/utils/server-slug";
import type { Finding, Narration, UrgencyTier } from "./types";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

interface Server {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  customer_id: string;
}

interface Channel {
  id: number;
  channel_type: string;
  name: string;
  config: Record<string, string>;
  priorities: string[];
}

const URGENCY_TO_PRIORITY: Record<UrgencyTier, string> = {
  imminent: "P2",
  soon: "P3",
  scheduled: "P4",
  watch: "P4",
};

const URGENCY_EMOJI: Record<UrgencyTier, string> = {
  imminent: "\u26A1",     // lightning bolt
  soon: "\u26A0\uFE0F",   // warning
  scheduled: "\u{1F535}", // blue circle
  watch: "\u26AA",        // white circle
};

const URGENCY_LABEL: Record<UrgencyTier, string> = {
  imminent: "IMMINENT",
  soon: "SOON",
  scheduled: "SCHEDULED",
  watch: "WATCH",
};

const URGENCY_COLORS: Record<UrgencyTier, { text: string; bg: string; border: string }> = {
  imminent:  { text: "#E5564B", bg: "#2A1517", border: "#E5564B" },
  soon:      { text: "#E0A93B", bg: "#2A2412", border: "#E0A93B" },
  scheduled: { text: "#3B82F6", bg: "#111726", border: "#3B82F6" },
  watch:     { text: "#A2A9B4", bg: "#121417", border: "#313742" },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dashboardUrl(server: Server, warningId: number): string {
  return `${serverDetailUrl(server)}#warning-${warningId}`;
}

/** Dispatch result. `delivered` is true iff at least one channel for the
 *  customer accepted the send. The job uses this to decide whether to
 *  persist `notified_at`, so a transient outage doesn't get remembered as
 *  a successful delivery. `attempted` is true if any channel matched the
 *  urgency-tier priority filter and was tried. */
export interface DispatchResult {
  attempted: boolean;
  delivered: boolean;
  channelsTried: number;
  channelsDelivered: number;
}

export async function dispatchTrendWarning(
  serverId: string,
  warningId: number,
  finding: Finding,
  narration: Narration,
  tier: UrgencyTier,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    attempted: false, delivered: false,
    channelsTried: 0, channelsDelivered: 0,
  };

  const serverResult = await query(
    `SELECT id, name, hostname, ip, customer_id FROM servers WHERE id = $1`,
    [serverId]
  );
  if (serverResult.rows.length === 0) return result;
  const server: Server = serverResult.rows[0];

  const channelResult = await query(
    `SELECT id, channel_type, name, config, priorities FROM alert_channels WHERE customer_id = $1 AND enabled = TRUE`,
    [server.customer_id]
  );
  const channels: Channel[] = channelResult.rows;
  if (channels.length === 0) return result;

  const requiredPriority = URGENCY_TO_PRIORITY[tier];

  for (const channel of channels) {
    // Canonical default, imported. The literal that used to be here was
    // ["P1","P2","P3","P4"], which disagreed with the alert dispatcher's
    // fallback on BOTH ends: it dropped P0 and it included P4. Consequence of
    // fixing it: a channel row with NO stored priority list no longer receives
    // scheduled/watch trend notifications, because those map to P4 and P4 sits
    // below the default notify threshold by design. Channels that stored an
    // explicit list (every channel created through the UI or API) keep exactly
    // what they chose.
    const channelPrios = channel.priorities || DEFAULT_PRIORITIES;
    if (!channelPrios.includes(requiredPriority)) continue;

    result.attempted = true;
    result.channelsTried += 1;

    let success = false;
    let error = "";
    try {
      switch (channel.channel_type) {
        case "telegram":
          success = await sendTelegram(channel.config, server, warningId, finding, narration, tier);
          break;
        case "slack":
          success = await sendSlack(channel.config, server, warningId, finding, narration, tier);
          break;
        case "email":
          success = await sendEmail(channel.config, server, warningId, finding, narration, tier);
          break;
      }
    } catch (err: any) {
      error = err?.message || "Unknown error";
      console.error(`[trend-warnings] ${channel.channel_type} failed:`, error);
    }

    if (success) {
      result.delivered = true;
      result.channelsDelivered += 1;
    }

    try {
      await clickhouse.insert({
        table: "notification_log",
        values: [{
          server_id: serverId,
          timestamp: Date.now(),
          channel_type: channel.channel_type,
          channel_name: channel.name || channel.channel_type,
          alert_type: `trend_warning:${finding.type}`,
          success: success ? 1 : 0,
          error,
        }],
        format: "JSONEachRow",
      });
    } catch { /* logging failure is non-fatal */ }
  }

  return result;
}

// --- Telegram ---

async function sendTelegram(
  config: Record<string, string>,
  server: Server,
  warningId: number,
  finding: Finding,
  narration: Narration,
  tier: UrgencyTier,
): Promise<boolean> {
  const { chat_id } = config;
  const bot_token = process.env.TELEGRAM_BOT_TOKEN;
  if (!bot_token || !chat_id) return false;

  // Hostname comes straight from the collector snapshot; HTML-escape
  // before wrapping in <code> tags so a hostile or malformed hostname
  // can't break the parse_mode=HTML message. Narration fields below
  // already use escapeHtml. Codex 2026-05-12 P3.
  const serverLabel = `<code>${escapeHtml(server.hostname || server.name)}</code>`;
  const url = dashboardUrl(server, warningId);
  const emoji = URGENCY_EMOJI[tier];
  const label = URGENCY_LABEL[tier];
  const correlationBadge = finding.correlation_match ? ` (${finding.correlation_match})` : "";

  let text = `${emoji} <b>Trend Warning: ${label}</b>\n`;
  text += `Server: ${serverLabel}\n`;
  text += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n`;
  text += `<b>${escapeHtml(narration.headline)}</b>\n\n`;
  text += `${escapeHtml(narration.evidence_summary)}\n\n`;
  text += `<i>${escapeHtml(narration.uncertainty_statement)}</i>\n`;

  if (narration.recommended_checks.length > 0) {
    text += `\n<b>Next checks:</b>\n`;
    for (const c of narration.recommended_checks.slice(0, 3)) {
      text += `\u2022 ${escapeHtml(c)}\n`;
    }
  }
  if (narration.recommended_actions.length > 0) {
    text += `\n<b>Recommended action:</b>\n`;
    text += `\u2022 ${escapeHtml(narration.recommended_actions[0])}\n`;
  }

  text += `\nConfidence: ${finding.severity}${correlationBadge}\n`;
  text += `<a href="${url}">View details</a>`;

  let res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "5", 10);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
  }
  return res.ok;
}

// --- Slack ---

async function sendSlack(
  config: Record<string, string>,
  server: Server,
  warningId: number,
  finding: Finding,
  narration: Narration,
  tier: UrgencyTier,
): Promise<boolean> {
  const { webhook_url } = config;
  if (!webhook_url) return false;

  const url = dashboardUrl(server, warningId);
  const emoji = URGENCY_EMOJI[tier];
  const label = URGENCY_LABEL[tier];
  const color = URGENCY_COLORS[tier].border;
  const correlationBadge = finding.correlation_match ? ` \u2022 ${finding.correlation_match}` : "";

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} Trend Warning ${label}: ${narration.headline}`.slice(0, 150) },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Server:*\n${server.hostname || server.name}` },
        { type: "mrkdwn", text: `*Confidence:*\n${finding.severity}${correlationBadge}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: narration.evidence_summary } },
    { type: "context", elements: [{ type: "mrkdwn", text: `_${narration.uncertainty_statement}_` }] },
  ];

  if (narration.recommended_checks.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Next checks:*\n${narration.recommended_checks.slice(0, 3).map(c => `\u2022 ${c}`).join("\n")}` },
    });
  }
  if (narration.recommended_actions.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Recommended actions:*\n${narration.recommended_actions.slice(0, 3).map(a => `\u2022 ${a}`).join("\n")}` },
    });
  }
  blocks.push({
    type: "actions",
    elements: [{ type: "button", text: { type: "plain_text", text: "View in Glassmkr" }, url }],
  });

  try {
    const res = await safeFetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [{ color, blocks }] }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.warn(`[trend-warnings] slack webhook blocked by SSRF guard: ${err.message}`);
      return false;
    }
    throw err;
  }
}

// --- Email ---

async function sendEmail(
  config: Record<string, string>,
  server: Server,
  warningId: number,
  finding: Finding,
  narration: Narration,
  tier: UrgencyTier,
): Promise<boolean> {
  if (!resend) {
    console.warn("[trend-warnings] RESEND_API_KEY not configured, skipping email");
    return false;
  }
  const { email } = config;
  if (!email) return false;

  const { subject, html, text } = formatEmail(server, warningId, finding, narration, tier);
  try {
    const { error } = await resend.emails.send({
      from: "Glassmkr Trend Warnings <alerts@glassmkr.com>",
      to: email,
      subject,
      html,
      text,
    });
    if (error) {
      console.error("[trend-warnings] Resend error:", error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[trend-warnings] Email send failed:", err?.message);
    return false;
  }
}

function formatEmail(
  server: Server,
  warningId: number,
  finding: Finding,
  narration: Narration,
  tier: UrgencyTier,
): { subject: string; html: string; text: string } {
  const label = URGENCY_LABEL[tier];
  const color = URGENCY_COLORS[tier];
  const url = dashboardUrl(server, warningId);
  const correlationBadge = finding.correlation_match ? ` (${finding.correlation_match})` : "";

  const subject = `[Trend Warning ${label}] ${narration.headline} on ${server.hostname || server.name}`;

  const textLines = [
    `Trend Warning: ${label} ${narration.headline}`,
    `Server: ${server.hostname || server.name}${server.ip ? ` (${server.ip})` : ""}`,
    "",
    narration.evidence_summary,
    "",
    narration.uncertainty_statement,
    "",
    "Next checks:",
    ...narration.recommended_checks.map((c) => `  ${c}`),
    "",
    "Recommended actions:",
    ...narration.recommended_actions.map((a) => `  ${a}`),
    "",
    `Confidence: ${finding.severity}${correlationBadge}`,
    `View details: ${url}`,
  ];
  const text = textLines.join("\n");

  const checkList = narration.recommended_checks.slice(0, 3)
    .map((c) => `<li style="margin-bottom:4px;">${escapeHtml(c)}</li>`)
    .join("");
  const actionList = narration.recommended_actions.slice(0, 3)
    .map((a) => `<li style="margin-bottom:4px;">${escapeHtml(a)}</li>`)
    .join("");

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#0B0C0E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="background-color:#0B0C0E;padding:32px 16px;">
    <table role="presentation" style="max-width:560px;width:100%;margin:0 auto;border-collapse:collapse;">
      <tr><td style="background-color:#121417;border:1px solid #313742;border-radius:10px;border-left:4px solid ${color.border};overflow:hidden;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:20px 24px 0 24px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${color.text};background-color:${color.bg};">
              Trend Warning &middot; ${escapeHtml(label)}
            </span>
          </td></tr>
          <tr><td style="padding:10px 24px 0 24px;">
            <div style="font-size:17px;font-weight:600;color:#ECEEF1;line-height:1.3;">${escapeHtml(narration.headline)}</div>
          </td></tr>
          <tr><td style="padding:8px 24px 0 24px;">
            <div style="font-size:14px;color:#A2A9B4;line-height:1.55;">${escapeHtml(narration.evidence_summary)}</div>
          </td></tr>
          <tr><td style="padding:12px 24px 0 24px;">
            <div style="font-size:13px;color:#A2A9B4;line-height:1.5;border-left:2px solid #313742;padding-left:12px;font-style:italic;">
              ${escapeHtml(narration.uncertainty_statement)}
            </div>
          </td></tr>
          <tr><td style="padding:14px 24px 0 24px;">
            <div style="font-size:12px;color:#6B7280;line-height:1.5;">
              Server: ${escapeHtml(server.hostname || server.name)}${server.ip ? ` (${escapeHtml(server.ip)})` : ""}
              &nbsp;&middot;&nbsp;Confidence: ${escapeHtml(finding.severity)}${escapeHtml(correlationBadge)}
            </div>
          </td></tr>
          <tr><td style="padding:16px 24px 0 24px;"><div style="height:1px;background-color:#313742;"></div></td></tr>
          <tr><td style="padding:16px 24px 0 24px;">
            <div style="font-size:11px;font-weight:600;color:#A2A9B4;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Next checks</div>
            <ul style="margin:0;padding-left:18px;color:#ECEEF1;font-size:13px;line-height:1.6;">${checkList}</ul>
          </td></tr>
          <tr><td style="padding:16px 24px 0 24px;">
            <div style="font-size:11px;font-weight:600;color:#A2A9B4;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Recommended actions</div>
            <ul style="margin:0;padding-left:18px;color:#ECEEF1;font-size:13px;line-height:1.6;">${actionList}</ul>
          </td></tr>
          <tr><td style="padding:20px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:6px;">
              <tr><td bgcolor="#ff6b35" style="border-radius:6px;padding:10px 28px;" align="center">
                <a href="${url}" target="_blank" style="font-size:14px;font-weight:600;color:#0B0C0E;text-decoration:none;display:block;">View details</a>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 0 0 0;text-align:center;">
        <div style="font-size:12px;color:#6B7280;">
          Glassmkr &nbsp;&middot;&nbsp;
          <a href="https://glassmkr.com" style="color:#A2A9B4;text-decoration:none;">glassmkr.com</a>
        </div>
      </td></tr>
    </table>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
