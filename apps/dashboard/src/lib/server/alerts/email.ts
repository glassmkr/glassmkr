import { Resend } from "resend";
import {
  getPriority,
  PRIORITY_LABELS,
  formatDuration,
} from "$lib/alerts/presentation";
import { getFixCommands } from "./notify-utils";
import { serverDetailUrl } from "$lib/utils/server-slug";

// Brand-matched priority colors (solid hex, no alpha - email clients don't support rgba)
const EMAIL_PRIORITY_COLORS: Record<number, { text: string; bg: string; border: string }> = {
  0: { text: "#E5564B", bg: "#2a0e0e", border: "#B91C1C" },  // P0 critical: deepest red band (matches SLACK_COLORS[0])
  1: { text: "#E5564B", bg: "#2A1517", border: "#E5564B" },  // red
  2: { text: "#E0A93B", bg: "#2A2412", border: "#E0A93B" },  // orange
  3: { text: "#F5A623", bg: "#1f1a0f", border: "#F5A623" },  // amber/gold (matches --accent)
};
const RESOLVED_COLORS = { text: "#46B98A", bg: "#0f1f19", border: "#46B98A" };

// Shared brand chrome, kept in lockstep with billing/email.ts glassmkrEmailShell:
// dark-mode meta (stops clients recoloring the amber CTA into brown) + the
// hexagon/wordmark lockup header + the tagline footer. The card BETWEEN them
// varies per alert type and keeps its own semantic severity band (the
// border-left color is the severity signal, not the brand accent, exactly as
// the Slack color band is left semantic).
const EMAIL_SHELL_OPEN = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>:root { color-scheme: dark; supported-color-schemes: dark; }</style>
</head>
<body style="margin:0;padding:0;background-color:#0B0C0E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="background-color:#0B0C0E;padding:32px 16px;">
    <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
    <table role="presentation" style="max-width:560px;width:100%;margin:0 auto;border-collapse:collapse;">
      <tr><td style="padding:0 4px 20px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:9px;line-height:0;">
            <img src="https://glassmkr.com/glassmkr-mark.png" width="26" height="26" alt="" style="display:block;border:0;outline:none;text-decoration:none;">
          </td>
          <td style="vertical-align:middle;font-size:16px;font-weight:700;letter-spacing:0.14em;color:#ECEEF1;">GLASSMKR</td>
        </tr></table>
      </td></tr>`;

const EMAIL_SHELL_FOOTER = `      <tr><td style="padding:22px 0 0 0;text-align:center;">
        <div style="font-size:12px;color:#6B7280;line-height:1.7;">
          Bare metal early-warning system<br>
          <a href="https://glassmkr.com" style="color:#A2A9B4;text-decoration:none;">glassmkr.com</a>
        </div>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </div>
</body>
</html>`;

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Alert {
  alert_type: string;
  severity?: string;
  title: string;
  message: string;
  recommendation?: string;
  evidence?: Record<string, unknown>;
  first_seen?: string;
  resolved_at?: string;
}

interface Server {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  os_id?: string | null;
  os_id_like?: string | null;
  os_version_id?: string | null;
  dmi_vendor?: string | null;
}

function formatAlertEmail(alert: Alert, server: Server): { subject: string; html: string; text: string } {
  const p = getPriority(alert.alert_type, alert.severity);
  const label = PRIORITY_LABELS[p] || "P3 MEDIUM";
  const pc = EMAIL_PRIORITY_COLORS[p] || EMAIL_PRIORITY_COLORS[3];
  // Prefer fix_commands baked into evidence at ingest time (carries the
  // distro-correct variant selected from the snapshot's os_id). Fall back to
  // getFixCommands, which resolves the rule's YAML fix command (the generic
  // wildcard variant when no evidence or OS hints are present).
  const commands: string[] = getFixCommands(alert.alert_type, alert.evidence, server);
  const dashboardUrl = serverDetailUrl(server);

  const subject = `[${label}] ${alert.title} on ${server.hostname || server.name}`;

  // Plain text
  const textLines = [
    `${label}: ${alert.title}`,
    `Server: ${server.hostname || server.name}${server.ip ? ` (${server.ip})` : ""}`,
    "",
    alert.message,
  ];
  if (alert.recommendation) {
    textLines.push("", alert.recommendation);
  }
  if (commands.length > 0) {
    textLines.push("", "Diagnostic commands:");
    for (const cmd of commands) textLines.push(`  ${cmd}`);
  }
  if (alert.first_seen) {
    textLines.push("", `Fired: ${new Date(alert.first_seen).toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }
  textLines.push("", `View in Dashboard: ${dashboardUrl}`);
  const text = textLines.join("\n");

  // HTML (table-based for email client compatibility)
  // Colors match brand design tokens (warm palette, not cool blue-gray)
  let commandsHtml = "";
  if (commands.length > 0) {
    const cmdLines = commands.map((cmd) => {
      if (cmd === "") return `<div style="height:6px"></div>`;
      if (cmd.startsWith("#")) return `<div style="color:#6B7280;font-family:'SF Mono',SFMono-Regular,'Fira Code',Consolas,'Courier New',monospace;font-size:12px;line-height:20px;">${escapeHtml(cmd)}</div>`;
      return `<div style="color:#ECEEF1;font-family:'SF Mono',SFMono-Regular,'Fira Code',Consolas,'Courier New',monospace;font-size:12px;line-height:20px;">${escapeHtml(cmd)}</div>`;
    }).join("");

    commandsHtml = `
      <tr><td style="padding:16px 24px 0 24px;">
        <div style="font-size:11px;font-weight:600;color:#A2A9B4;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Fix</div>
        <div style="background:#121417;border:1px solid #313742;border-radius:6px;padding:14px 16px;">
          ${cmdLines}
        </div>
      </td></tr>`;
  }

  let recommendationHtml = "";
  if (alert.recommendation) {
    recommendationHtml = `
      <tr><td style="padding:12px 24px 0 24px;">
        <div style="font-size:13px;color:#A2A9B4;line-height:1.5;border-left:2px solid #313742;padding-left:12px;">
          ${escapeHtml(alert.recommendation)}
        </div>
      </td></tr>`;
  }

  const firedLine = alert.first_seen
    ? `&nbsp;&middot;&nbsp;Fired: ${new Date(alert.first_seen).toISOString().replace("T", " ").slice(0, 16)} UTC`
    : "";

  const html = `${EMAIL_SHELL_OPEN}
      <tr><td style="background-color:#121417;border:1px solid #313742;border-radius:10px;border-left:4px solid ${pc.border};overflow:hidden;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:20px 24px 0 24px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${pc.text};background-color:${pc.bg};">
              ${escapeHtml(label)}
            </span>
          </td></tr>
          <tr><td style="padding:10px 24px 0 24px;">
            <div style="font-size:17px;font-weight:600;color:#ECEEF1;line-height:1.3;">${escapeHtml(alert.title)}</div>
          </td></tr>
          <tr><td style="padding:8px 24px 0 24px;">
            <div style="font-size:14px;color:#A2A9B4;line-height:1.55;">${escapeHtml(alert.message)}</div>
          </td></tr>
          ${recommendationHtml}
          <tr><td style="padding:14px 24px 0 24px;">
            <div style="font-size:12px;color:#6B7280;line-height:1.5;">
              Server: ${escapeHtml(server.hostname || server.name)}${server.ip ? ` (${escapeHtml(server.ip)})` : ""}
              ${firedLine}
            </div>
          </td></tr>
          <tr><td style="padding:16px 24px 0 24px;"><div style="height:1px;background-color:#313742;"></div></td></tr>
          ${commandsHtml}
          <tr><td style="padding:20px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:6px;">
              <tr>
                <td bgcolor="#F5A623" style="border-radius:6px;padding:10px 28px;" align="center">
                  <a href="${dashboardUrl}" target="_blank" style="font-size:14px;font-weight:600;color:#0B0C0E;text-decoration:none;display:block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">View in Dashboard</a>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
${EMAIL_SHELL_FOOTER}`;

  return { subject, html, text };
}

function formatResolvedEmail(alert: Alert, server: Server): { subject: string; html: string; text: string } {
  const duration = alert.resolved_at && alert.first_seen
    ? formatDuration(new Date(alert.resolved_at).getTime() - new Date(alert.first_seen).getTime())
    : "unknown duration";

  const subject = `[RESOLVED] ${alert.title} on ${server.hostname || server.name}`;

  const text = [
    `RESOLVED: ${alert.title}`,
    `Server: ${server.hostname || server.name}`,
    "",
    `Was firing for ${duration}.`,
    alert.resolved_at ? `Resolved at ${new Date(alert.resolved_at).toISOString().replace("T", " ").slice(0, 19)} UTC.` : "",
  ].join("\n");

  const resolvedAt = alert.resolved_at
    ? `Resolved at ${new Date(alert.resolved_at).toISOString().replace("T", " ").slice(0, 16)} UTC.`
    : "";

  const html = `${EMAIL_SHELL_OPEN}
      <tr><td style="background-color:#121417;border:1px solid #313742;border-radius:10px;border-left:4px solid ${RESOLVED_COLORS.border};overflow:hidden;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:20px 24px 0 24px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${RESOLVED_COLORS.text};background-color:${RESOLVED_COLORS.bg};">
              Resolved
            </span>
          </td></tr>
          <tr><td style="padding:10px 24px 0 24px;">
            <div style="font-size:17px;font-weight:600;color:#ECEEF1;line-height:1.3;">${escapeHtml(alert.title)}</div>
          </td></tr>
          <tr><td style="padding:8px 24px 0 24px;">
            <div style="font-size:14px;color:#A2A9B4;line-height:1.55;">
              Was firing for ${escapeHtml(duration)}. ${escapeHtml(resolvedAt)}
            </div>
          </td></tr>
          <tr><td style="padding:14px 24px 20px 24px;">
            <div style="font-size:12px;color:#6B7280;">
              Server: ${escapeHtml(server.hostname || server.name)}
            </div>
          </td></tr>
        </table>
      </td></tr>
${EMAIL_SHELL_FOOTER}`;

  return { subject, html, text };
}

export async function sendEmail(
  config: Record<string, string>,
  newAlerts: Alert[],
  resolvedAlerts: Alert[],
  server: Server
): Promise<boolean> {
  if (!resend) {
    console.warn("[notify] RESEND_API_KEY not configured, skipping email");
    return false;
  }

  const { email } = config;
  if (!email) return false;

  let allOk = true;

  // Sort new alerts by priority (P1 first)
  const sorted = [...newAlerts].sort((a, b) =>
    getPriority(a.alert_type, a.severity) - getPriority(b.alert_type, b.severity)
  );

  for (const alert of sorted) {
    const { subject, html, text } = formatAlertEmail(alert, server);
    try {
      const { error } = await resend.emails.send({
        from: "Glassmkr Alerts <alerts@glassmkr.com>",
        to: email,
        subject,
        html,
        text,
      });
      if (error) {
        console.error("[notify] Resend error:", error);
        allOk = false;
        // Stop on rate limit
        if ((error as any).statusCode === 429) break;
      }
    } catch (err: any) {
      console.error("[notify] Email send failed:", err.message);
      allOk = false;
    }
  }

  for (const alert of resolvedAlerts) {
    const { subject, html, text } = formatResolvedEmail(alert, server);
    try {
      const { error } = await resend.emails.send({
        from: "Glassmkr Alerts <alerts@glassmkr.com>",
        to: email,
        subject,
        html,
        text,
      });
      if (error) {
        console.error("[notify] Resend resolved error:", error);
        allOk = false;
        if ((error as any).statusCode === 429) break;
      }
    } catch (err: any) {
      console.error("[notify] Email resolved send failed:", err.message);
      allOk = false;
    }
  }

  return allOk;
}

export async function sendTestEmail(emailAddress: string): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    return { success: false, error: "Email service not configured (RESEND_API_KEY missing)" };
  }

  try {
    const { error } = await resend.emails.send({
      from: "Glassmkr Alerts <alerts@glassmkr.com>",
      to: emailAddress,
      subject: "[TEST] Glassmkr Alert Test",
      html: `${EMAIL_SHELL_OPEN}
      <tr><td style="background-color:#121417;border:1px solid #313742;border-radius:10px;border-left:4px solid ${RESOLVED_COLORS.border};overflow:hidden;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:20px 24px 0 24px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${RESOLVED_COLORS.text};background-color:${RESOLVED_COLORS.bg};">
              Test
            </span>
          </td></tr>
          <tr><td style="padding:10px 24px 0 24px;">
            <div style="font-size:17px;font-weight:600;color:#ECEEF1;line-height:1.3;">Test Alert from Glassmkr</div>
          </td></tr>
          <tr><td style="padding:8px 24px 20px 24px;">
            <div style="font-size:14px;color:#A2A9B4;line-height:1.55;">If you received this, email notifications are working correctly.</div>
          </td></tr>
        </table>
      </td></tr>
${EMAIL_SHELL_FOOTER}`,
      text: "Test Alert from Glassmkr\n\nIf you received this, email notifications are working correctly.",
    });

    if (error) {
      return { success: false, error: (error as any).message || "Resend API error" };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
