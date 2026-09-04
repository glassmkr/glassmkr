import { query } from "@glassmkr/db/pg";
import { DEFAULT_PRIORITIES } from "$lib/alerts/priority";
import { clickhouse } from "@glassmkr/db/clickhouse";
import {
  getPriority,
  PRIORITY_LABELS,
  PRIORITY_EMOJI,
  SLACK_COLORS,
  RESOLVED_COLOR,
  formatDuration,
  expandChannelPriorities,
} from "$lib/alerts/presentation";
import { getFixCommands, topFixLines, sortByPriority, clampForSink } from "./notify-utils";
import { escapeHtml, escapeSlackMrkdwn, escapeDiscord } from "$lib/server/notify/escape";
import { serverDetailUrl } from "$lib/utils/server-slug";
import { sendEmail } from "./email";
import { buildContextBlock } from "./context";
import { safeFetch, SsrfBlockedError } from "$lib/server/net/safe-fetch";
import { take, TIER_WEBHOOK_SEND } from "$lib/server/auth/rate-limit";
import { isBillingEnforcementEnabled } from "$lib/server/billing/enforcement-flag";

interface Alert {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  evidence?: Record<string, unknown>;
  recommendation: string;
  first_seen?: string;
}

interface Server {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  customer_id: string;
  status: string;
  os_id: string | null;
  os_id_like: string | null;
  os_version_id: string | null;
  dmi_vendor: string | null;
}

interface Channel {
  id: number;
  channel_type: string;
  name: string;
  config: Record<string, string>;
  priorities: string[];
}

export async function dispatchNotifications(
  serverId: string,
  newAlerts: Alert[],
  resolvedAlerts: Alert[]
): Promise<void> {
  if (newAlerts.length === 0 && resolvedAlerts.length === 0) return;

  const serverResult = await query(
    `SELECT id, name, hostname, ip, customer_id, status, os_id, os_id_like, os_version_id, dmi_vendor FROM servers WHERE id = $1`,
    [serverId]
  );
  if (serverResult.rows.length === 0) return;
  const server: Server = serverResult.rows[0];

  // Billing-enforcement gate: when the flag is on AND the server is
  // suspended, suppress channel fanout. Snapshot ingest and alert-state
  // updates have already happened upstream of this function - only the
  // delivery side is suppressed, so when the customer restores the
  // server they have full alert history. While the flag is off (default
  // for PR A), pass through unchanged regardless of suspended state.
  if (server.status === "suspended" && isBillingEnforcementEnabled()) {
    console.log(`[billing-enforcement] alert dispatch suppressed server=${server.id} new=${newAlerts.length} resolved=${resolvedAlerts.length} reason=server-suspended`);
    return;
  }

  const channelResult = await query(
    `SELECT id, channel_type, name, config, priorities FROM alert_channels WHERE customer_id = $1 AND enabled = TRUE`,
    [server.customer_id]
  );
  const channels: Channel[] = channelResult.rows;
  if (channels.length === 0) return;

  // Pre-compute the per-alert context block once and share across all
  // channels. Rules without a CONTEXT_METRICS entry return null and the
  // notification renders exactly as before. A failure here (ClickHouse
  // outage, etc.) already falls back inside buildContextBlock; double
  // guarding here in case the function itself throws unexpectedly.
  const contextByAlertId = new Map<number, string>();
  await Promise.all(
    newAlerts.map(async (a) => {
      try {
        const block = await buildContextBlock(a.alert_type, serverId);
        if (block) contextByAlertId.set(a.id, block);
      } catch (err: any) {
        console.warn(`[notify] context build failed for alert ${a.id}: ${err?.message}`);
      }
    }),
  );

  for (const channel of channels) {
    let success = false;
    let error = "";

    // Filter alerts by channel's priority settings.
    //
    // Codex 2026-05-22B F1: customer channel rows in Postgres were
    // populated before the P0 tier existed (default was ["P1","P2","P3","P4"]),
    // and the rule library now declares P0 for GPU ECC / XID / MCE uncorrected.
    // If a channel opts into P1 (paging-grade), `expandChannelPriorities`
    // includes P0 in the effective list so existing channel configs keep
    // paging on P0 events without manual re-save.
    //
    // The fallback is the canonical default, imported rather than written out:
    // this literal and the trend dispatcher's disagreed with each other
    // (P0..P3 here, P1..P4 there) for as long as both were hand-written.
    const channelPrios = channel.priorities || DEFAULT_PRIORITIES;
    const effectivePrios = expandChannelPriorities(channelPrios);
    const filteredNew = newAlerts.filter((a) => {
      const p = getPriority(a.alert_type, a.severity);
      return effectivePrios.includes(`P${p}`);
    });
    const filteredResolved = resolvedAlerts.filter((a) => {
      const p = getPriority(a.alert_type, a.severity);
      return effectivePrios.includes(`P${p}`);
    });

    if (filteredNew.length === 0 && filteredResolved.length === 0) continue;

    try {
      switch (channel.channel_type) {
        case "telegram":
          success = await sendTelegram(channel.config, filteredNew, filteredResolved, server, contextByAlertId);
          break;
        case "slack":
          success = await sendSlack(channel.config, filteredNew, filteredResolved, server);
          break;
        case "email":
          success = await sendEmail(channel.config, filteredNew, filteredResolved, server);
          break;
        case "discord":
          success = await sendDiscord(channel.config, filteredNew, filteredResolved, server);
          break;
        case "webhook":
          success = await sendWebhook(channel.config, filteredNew, filteredResolved, server);
          break;
        case "pagerduty":
          success = await sendPagerDuty(channel.config, filteredNew, filteredResolved, server);
          break;
      }
    } catch (err: any) {
      error = err.message || "Unknown error";
      console.error(`[notify] ${channel.channel_type} failed:`, error);
    }

    for (const alert of [...filteredNew, ...filteredResolved]) {
      try {
        await clickhouse.insert({
          table: "notification_log",
          values: [{
            server_id: serverId,
            timestamp: Date.now(),
            channel_type: channel.channel_type,
            channel_name: channel.name || channel.channel_type,
            alert_type: alert.alert_type || alert.title,
            success: success ? 1 : 0,
            error,
          }],
          format: "JSONEachRow",
        });
      } catch { /* logging failure should not break dispatch */ }
    }
  }

  for (const alert of newAlerts) {
    // bola-exempt: alert.id was loaded by a customer-scoped SELECT
    // upstream; this is a notification-flag flip on rows we already own.
    await query(
      `UPDATE active_alerts SET notification_sent = TRUE, notification_sent_at = NOW() WHERE id = $1`,
      [alert.id]
    ).catch(() => {});
  }
}

// --- Telegram (HTML parse mode) ---

// Bot API caps sendMessage text at 4096 characters. The message body gets a
// 3000 budget and the title 256, leaving room for the fixed framing, the
// recommendation and the top fix lines (Codex 2026-09-04 #2).
const TELEGRAM_TITLE_MAX = 256;
const TELEGRAM_BODY_MAX = 3000;

function buildTelegramAlert(alert: Alert, server: Server, contextBlock?: string): string {
  const p = getPriority(alert.alert_type, alert.severity);
  const emoji = PRIORITY_EMOJI[p] || "\u{1F7E1}";
  const label = PRIORITY_LABELS[p] || "P3 MEDIUM";
  // Escape every host-derived field for Telegram HTML; the template tags stay
  // literal (C-1). dashboardUrl is our own generated URL, not host input.
  const serverLabel = `<code>${escapeHtml(server.hostname || server.name)}</code>` + (server.ip ? ` (${escapeHtml(server.ip)})` : "");
  const commands = getFixCommands(alert.alert_type, alert.evidence, server);
  const dashboardUrl = serverDetailUrl(server);

  let text = `${emoji} <b>${label}: ${clampForSink(escapeHtml(alert.title), TELEGRAM_TITLE_MAX)}</b>\n`;
  text += `Server: ${serverLabel}\n`;
  text += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n`;
  text += `${clampForSink(escapeHtml(alert.message), TELEGRAM_BODY_MAX)}\n`;

  // Phase 1 context enrichment: a text block between message and
  // recommendation for rules that have a CONTEXT_METRICS entry. See
  // CC_ALERT_CONTEXT_ENRICHMENT.md. Rendered inside <pre> so the
  // columnar layout stays readable on mobile Telegram.
  if (contextBlock) {
    text += `\n<pre>${escapeHtml(contextBlock)}</pre>\n`;
  }

  if (alert.recommendation) {
    text += `\n${escapeHtml(alert.recommendation)}\n`;
  }

  if (commands.length > 0) {
    const cmdText = topFixLines(commands);
    text += `\n<b>Fix:</b>\n<pre>${escapeHtml(cmdText)}</pre>\n`;
  }

  text += `\n<a href="${dashboardUrl}">View in Dashboard</a>`;
  return text;
}

function buildTelegramResolved(alert: Alert, server: Server): string {
  const serverLabel = `<code>${escapeHtml(server.hostname || server.name)}</code>`;
  const duration = alert.first_seen
    ? formatDuration(Date.now() - new Date(alert.first_seen).getTime())
    : "unknown duration";

  return `\u2705 <b>RESOLVED: ${escapeHtml(alert.title)}</b>\nServer: ${serverLabel}\n\nWas firing for ${duration}.`;
}

async function sendTelegram(
  config: Record<string, string>,
  newAlerts: Alert[],
  resolvedAlerts: Alert[],
  server: Server,
  contextByAlertId?: Map<number, string>,
): Promise<boolean> {
  const { chat_id } = config;
  const bot_token = process.env.TELEGRAM_BOT_TOKEN;
  if (!bot_token || !chat_id) return false;

  const messages: string[] = [];

  // Sort by priority (P1 first)
  const sorted = sortByPriority(newAlerts);

  for (const alert of sorted) {
    messages.push(buildTelegramAlert(alert, server, contextByAlertId?.get(alert.id)));
  }

  for (const alert of resolvedAlerts) {
    messages.push(buildTelegramResolved(alert, server));
  }

  if (messages.length === 0) return true;

  // Send as one message if short enough, otherwise split
  const combined = messages.join("\n\n");
  const texts = combined.length <= 4000 ? [combined] : messages;

  let allOk = true;
  for (const text of texts) {
    let res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    // Retry once on rate limit
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "5", 10);
      console.warn(`[notify] Telegram 429, retrying after ${retryAfter}s`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
    }
    if (!res.ok) {
      console.error(`[notify] Telegram send failed: ${res.status}`);
      allOk = false;
    }
  }
  return allOk;
}

// --- Slack (Block Kit) ---

// Block Kit limits: header plain_text 150, section mrkdwn text 3000. A block
// over its limit fails the whole webhook post (Codex 2026-09-04 #2).
const SLACK_HEADER_MAX = 150;
const SLACK_SECTION_MAX = 3000;

function buildSlackAlert(alert: Alert, server: Server): any {
  const p = getPriority(alert.alert_type, alert.severity);
  const emoji = PRIORITY_EMOJI[p] || ":yellow_circle:";
  const label = PRIORITY_LABELS[p] || "P3 MEDIUM";
  const commands = getFixCommands(alert.alert_type, alert.evidence, server);
  const dashboardUrl = serverDetailUrl(server);

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: clampForSink(`${emoji} ${label}: ${alert.title}`, SLACK_HEADER_MAX) },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: clampForSink(escapeSlackMrkdwn(alert.message), SLACK_SECTION_MAX) },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Server:*\n${escapeSlackMrkdwn(server.hostname || server.name)}` },
        { type: "mrkdwn", text: `*IP:*\n${escapeSlackMrkdwn(server.ip || "N/A")}` },
      ],
    },
  ];

  if (alert.recommendation) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_${escapeSlackMrkdwn(alert.recommendation)}_` },
    });
  }

  if (commands.length > 0) {
    // A Slack code block renders literally (no mrkdwn), so escaping the & < >
    // would corrupt copyable commands; only neutralise a ``` fence breakout.
    const safeCmd = topFixLines(commands).replace(/`{3,}/g, "");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Fix:*\n\`\`\`${safeCmd}\`\`\`` },
    });
  }

  blocks.push({
    type: "actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "View in Dashboard" },
      url: dashboardUrl,
    }],
  });

  // Brand footer. Semantic per-priority color band is preserved (red/orange/
  // yellow/blue = severity, NOT brand accent); the mark + name is the branding.
  blocks.push({
    type: "context",
    elements: [
      { type: "image", image_url: "https://glassmkr.com/glassmkr-mark.png", alt_text: "Glassmkr" },
      { type: "mrkdwn", text: "*Glassmkr*  ·  bare metal early-warning system" },
    ],
  });

  return { color: SLACK_COLORS[p] || "#d29a22", blocks };
}

async function sendSlack(
  config: Record<string, string>,
  newAlerts: Alert[],
  resolvedAlerts: Alert[],
  server: Server
): Promise<boolean> {
  const { webhook_url } = config;
  if (!webhook_url) return false;

  const attachments: any[] = [];

  const sorted = sortByPriority(newAlerts);

  for (const alert of sorted) {
    attachments.push(buildSlackAlert(alert, server));
  }

  if (resolvedAlerts.length > 0) {
    const resolvedList = resolvedAlerts.map(a => `\u2022 ${escapeSlackMrkdwn(a.title)}`).join("\n");
    attachments.push({
      color: RESOLVED_COLOR,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\u2705 *${resolvedAlerts.length} resolved* on *${escapeSlackMrkdwn(server.hostname || server.name)}*\n${resolvedList}`,
          },
        },
      ],
    });
  }

  if (attachments.length === 0) return true;

  // safeFetch (SSRF guard, §1.7): webhook_url is customer-controlled.
  // A blocked target (private/loopback/IMDS/internal port) is a failed
  // delivery, not a 500.
  try {
    const res = await safeFetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.warn(`[dispatch] webhook blocked by SSRF guard: ${err.message}`);
      return false;
    }
    throw err;
  }
}

// --- Discord (incoming webhook, embeds) ---
// Discord embed colors are decimal ints. One embed per new alert (Discord caps
// a message at 10 embeds), plus a resolved-summary embed.

const DISCORD_COLORS: Record<number, number> = { 1: 0xd64545, 2: 0xe0823d, 3: 0xd29a22, 4: 0x3b82c4 };
const DISCORD_RESOLVED = 0x3ba55c;

function buildDiscordEmbed(alert: Alert, server: Server): Record<string, unknown> {
  const p = getPriority(alert.alert_type, alert.severity);
  const label = PRIORITY_LABELS[p] || "P3 MEDIUM";
  const commands = getFixCommands(alert.alert_type, alert.evidence, server);
  // Embed title / description / field values render Discord markdown, so escape
  // host-derived text (C-1). The Fix code block renders literally, so it is only
  // fence-neutralised, not escaped, to keep the commands copyable.
  const safeCmd = commands.length > 0 ? topFixLines(commands).replace(/`{3,}/g, "") : "";
  const fields: Array<Record<string, unknown>> = [
    { name: "Server", value: `${escapeDiscord(server.hostname || server.name)}${server.ip ? ` (${escapeDiscord(server.ip)})` : ""}` },
  ];
  if (alert.recommendation) fields.push({ name: "Recommendation", value: escapeDiscord(alert.recommendation).slice(0, 1024) });
  if (commands.length > 0) fields.push({ name: "Fix", value: ("```\n" + safeCmd + "\n```").slice(0, 1024) });
  return {
    title: `${label}: ${escapeDiscord(alert.title)}`.slice(0, 256),
    description: escapeDiscord(alert.message).slice(0, 4096),
    color: DISCORD_COLORS[p] ?? DISCORD_COLORS[3],
    url: serverDetailUrl(server),
    fields,
  };
}

async function sendDiscord(
  config: Record<string, string>,
  newAlerts: Alert[],
  resolvedAlerts: Alert[],
  server: Server,
): Promise<boolean> {
  const { webhook_url } = config;
  if (!webhook_url) return false;

  const embeds: Array<Record<string, unknown>> = sortByPriority(newAlerts)
    .slice(0, 9)
    .map((a) => buildDiscordEmbed(a, server));
  if (resolvedAlerts.length > 0) {
    embeds.push({
      title: `Resolved: ${resolvedAlerts.length} on ${escapeDiscord(server.hostname || server.name)}`.slice(0, 256),
      description: resolvedAlerts.map((a) => `• ${escapeDiscord(a.title)}`).join("\n").slice(0, 4096),
      color: DISCORD_RESOLVED,
    });
  }
  if (embeds.length === 0) return true;

  // safeFetch (SSRF guard): webhook_url is customer-controlled.
  try {
    const res = await safeFetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.warn(`[dispatch] discord webhook blocked by SSRF guard: ${err.message}`);
      return false;
    }
    throw err;
  }
}

// --- Generic webhook (structured JSON POST) ---
// Delivers a machine-readable payload so the customer can route it anywhere
// (their own bridge, an automation runner, etc.). No Glassmkr-specific shape
// assumptions beyond a documented envelope.

async function sendWebhook(
  config: Record<string, string>,
  newAlerts: Alert[],
  resolvedAlerts: Alert[],
  server: Server,
): Promise<boolean> {
  const { webhook_url } = config;
  if (!webhook_url) return false;
  if (newAlerts.length === 0 && resolvedAlerts.length === 0) return true;

  const payload = {
    event: "glassmkr.alerts",
    timestamp: new Date().toISOString(),
    server: { id: server.id, name: server.name, hostname: server.hostname, ip: server.ip },
    new_alerts: sortByPriority(newAlerts).map((a) => ({
      alert_type: a.alert_type,
      severity: a.severity,
      priority: `P${getPriority(a.alert_type, a.severity)}`,
      title: a.title,
      message: a.message,
      recommendation: a.recommendation || null,
    })),
    resolved_alerts: resolvedAlerts.map((a) => ({ alert_type: a.alert_type, title: a.title })),
    dashboard_url: serverDetailUrl(server),
  };

  // G3 (launch hardening, 2026-08-24): per-account outbound budget so the
  // generic webhook channel cannot be driven as a reflector toward public
  // targets. A blocked send is a failed delivery, never a 500.
  const budget = await take(TIER_WEBHOOK_SEND, server.customer_id);
  if (!budget.allowed) {
    console.warn(`[dispatch] generic webhook skipped: account ${server.customer_id} over outbound budget (retry in ${budget.retryAfterSeconds}s)`);
    return false;
  }

  // safeFetch (SSRF guard): webhook_url is customer-controlled.
  try {
    const res = await safeFetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.warn(`[dispatch] generic webhook blocked by SSRF guard: ${err.message}`);
      return false;
    }
    throw err;
  }
}

// --- PagerDuty (Events API v2) ---
// One event per alert with a stable dedup_key so a later resolve closes the
// same incident. The endpoint is the fixed PagerDuty host (not customer-
// controlled), so a regular fetch is correct; the routing key is the secret.

const PD_SEVERITY: Record<number, string> = { 1: "critical", 2: "error", 3: "warning", 4: "info" };
const PD_ENDPOINT = "https://events.pagerduty.com/v2/enqueue";

async function pagerDutyEvent(routing_key: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(PD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routing_key, ...body }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

async function sendPagerDuty(
  config: Record<string, string>,
  newAlerts: Alert[],
  resolvedAlerts: Alert[],
  server: Server,
): Promise<boolean> {
  const routing_key = config.routing_key || config.integration_key;
  if (!routing_key) return false;

  let allOk = true;
  for (const a of sortByPriority(newAlerts)) {
    const p = getPriority(a.alert_type, a.severity);
    const ok = await pagerDutyEvent(routing_key, {
      event_action: "trigger",
      dedup_key: `glassmkr/${server.id}/${a.alert_type}`,
      payload: {
        summary: `${a.title} on ${server.hostname || server.name}`.slice(0, 1024),
        severity: PD_SEVERITY[p] || "warning",
        source: server.hostname || server.name,
        component: a.alert_type,
        custom_details: { message: a.message, recommendation: a.recommendation || undefined, ip: server.ip },
      },
      links: [{ href: serverDetailUrl(server), text: "View in Dashboard" }],
    });
    if (!ok) allOk = false;
  }
  for (const a of resolvedAlerts) {
    const ok = await pagerDutyEvent(routing_key, {
      event_action: "resolve",
      dedup_key: `glassmkr/${server.id}/${a.alert_type}`,
    });
    if (!ok) allOk = false;
  }
  return allOk;
}
