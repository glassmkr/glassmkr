import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Shared email shell, reused by the billing and account-keys mailers.
// `category` shows in the small badge at the top ("Billing", "Account",
// etc.); the rest of the shell (palette, CTA pill, footer) stays the
// same so customers see one consistent brand.
export function glassmkrEmailShell(opts: {
  category: string;
  title: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
}): string {
  const { category, title, body, ctaText, ctaUrl } = opts;
  return `<!DOCTYPE html>
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
      </td></tr>
      <tr><td style="background-color:#121417;border:1px solid #313742;border-radius:12px;overflow:hidden;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:24px 26px 0 26px;">
            <span style="display:inline-block;padding:3px 11px;border-radius:999px;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#0B0C0E;background-color:#ff6b35;">${escapeHtml(category)}</span>
          </td></tr>
          <tr><td style="padding:14px 26px 0 26px;">
            <div style="font-size:19px;font-weight:600;color:#ECEEF1;line-height:1.3;letter-spacing:-0.01em;">${escapeHtml(title)}</div>
          </td></tr>
          <tr><td style="padding:10px 26px 0 26px;">
            <div style="font-size:14px;color:#A2A9B4;line-height:1.6;">${body}</div>
          </td></tr>
          <tr><td style="padding:22px 26px 26px 26px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:8px;">
              <tr>
                <td bgcolor="#ff6b35" style="border-radius:8px;padding:12px 30px;" align="center">
                  <a href="${escapeHtml(ctaUrl)}" target="_blank" style="font-size:14px;font-weight:600;color:#0B0C0E;text-decoration:none;display:block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(ctaText)}</a>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:22px 0 0 0;text-align:center;">
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
}

// Thin compat shim — historical billing call sites use `billingEmailShell`.
// The shared shell now takes a category arg; the billing flavour fixes
// it to "Billing" and forwards.
function billingEmailShell(title: string, body: string, ctaText: string, ctaUrl: string): string {
  return glassmkrEmailShell({ category: "Billing", title, body, ctaText, ctaUrl });
}

// ----------------------------------------------------------------------------
// Billing-enforcement email cascade (Phase 7 P1; gated on
// BILLING_ENFORCEMENT_ENABLED at call site, not here).
//
// Four emails:
//   1. Card removed (sent on `payment_method.detached` webhook)
//   2. T-3 reminder (3 days before grace_period_end via daily cron)
//   3. T-1 reminder (1 day before grace_period_end via daily cron)
//   4. Servers disabled (sent immediately when enforcement cron suspends)
//
// All four reuse `billingEmailShell()` for consistent branding. All four
// degrade-open if RESEND_API_KEY is unset (log, return false).
// ----------------------------------------------------------------------------

const DASHBOARD_HOST = process.env.DASHBOARD_PUBLIC_URL || "https://app.glassmkr.com";
const SETTINGS_URL = `${DASHBOARD_HOST}/settings`;

function fromAddress(): string {
  return "Glassmkr Billing <alerts@glassmkr.com>";
}

// Internal notification: a visitor left their email on the public demo's
// CTA. Goes to the founder inbox, not the visitor. Degrade-open (log +
// return false) if RESEND_API_KEY is unset so the lead is still persisted
// to demo_leads regardless of email delivery.
const DEMO_LEAD_INBOX = "simon.rybisar@cdn77.com";

export async function sendDemoLeadEmail(opts: {
  email: string;
  wantsCall: boolean;
  userAgent?: string | null;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[demo:lead] RESEND_API_KEY not configured, skipping lead email");
    return false;
  }
  const { email, wantsCall, userAgent } = opts;
  const title = wantsCall ? "Demo lead wants a call" : "New demo lead";
  const body = `
    <p style="margin:0 0 8px;">A visitor left their email on the live demo.</p>
    <p style="margin:0 0 4px;"><strong style="color:#ECEEF1;">Email:</strong> ${escapeHtml(email)}</p>
    <p style="margin:0 0 4px;"><strong style="color:#ECEEF1;">Wants a call:</strong> ${wantsCall ? "yes" : "no"}</p>
    ${userAgent ? `<p style="margin:0;font-size:12px;color:#6B7280;">${escapeHtml(userAgent)}</p>` : ""}
  `;
  const html = glassmkrEmailShell({
    category: "Demo lead",
    title,
    body,
    ctaText: `Reply to ${email}`,
    ctaUrl: `mailto:${email}`,
  });
  try {
    const result = await resend.emails.send({
      from: fromAddress(),
      to: DEMO_LEAD_INBOX,
      replyTo: email,
      subject: title,
      html,
      text: `New demo lead: ${email} (wants call: ${wantsCall ? "yes" : "no"})`,
    });
    if (result.error) {
      console.error("[demo:lead] Send failed:", result.error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[demo:lead] Send failed:", err.message);
    return false;
  }
}

function bulletList(items: string[]): string {
  if (items.length === 0) return "";
  const li = items.map((s) => `      <li style="margin:4px 0;">${escapeHtml(s)}</li>`).join("\n");
  return `<ul style="margin:8px 0 0 0;padding-left:20px;color:#A2A9B4;font-size:14px;line-height:1.55;">\n${li}\n    </ul>`;
}

function plainBullet(items: string[]): string {
  return items.map((s) => `  - ${s}`).join("\n");
}

/**
 * Email 1 — Card removed. Sent in response to `payment_method.detached`.
 * Fires only when BILLING_ENFORCEMENT_ENABLED is true (gating at the
 * webhook call site).
 */
export async function sendCardRemovedEmail(opts: {
  to: string;
  firstName: string;
  activeServerCount: number;
  currentPeriodEndUtc: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[billing:email] RESEND_API_KEY not configured, skipping card-removed email");
    return false;
  }
  const title = "Your payment method was removed";
  const bodyHtml = `Hi ${escapeHtml(opts.firstName)},<br><br>` +
    `Your payment method on Glassmkr was removed today.<br><br>` +
    `You're currently on the Pro plan with ${opts.activeServerCount} active servers. ` +
    `Your current billing period continues through ${escapeHtml(opts.currentPeriodEndUtc)}, ` +
    `after which servers beyond the 3-server free quota will be disabled until a payment method is restored.<br><br>` +
    `You can ignore this email if the removal was intentional and you're moving to the free tier. ` +
    `Your 3 oldest servers will stay active automatically.`;
  const html = billingEmailShell(title, bodyHtml, "Manage Subscription", SETTINGS_URL);
  const text = [
    `Hi ${opts.firstName},`,
    ``,
    `Your payment method on Glassmkr was removed today.`,
    ``,
    `You're currently on the Pro plan with ${opts.activeServerCount} active servers. Your current`,
    `billing period continues through ${opts.currentPeriodEndUtc}, after which servers beyond the`,
    `3-server free quota will be disabled until a payment method is restored.`,
    ``,
    `To keep all your servers active: ${SETTINGS_URL}`,
    ``,
    `You can ignore this email if the removal was intentional and you're moving to the free tier.`,
    `Your 3 oldest servers will stay active automatically.`,
    ``,
    `Cheers,`,
    `The Glassmkr team`,
  ].join("\n");
  return sendBilling({
    to: opts.to,
    subject: "Your payment method was removed",
    html,
    text,
    label: "card-removed",
  });
}

/**
 * Email 2 — T-3 reminder. Sent 3 days before grace_period_end via the
 * daily email-reminders cron.
 */
export async function sendT3ReminderEmail(opts: {
  to: string;
  firstName: string;
  gracePeriodEndUtc: string;
  keptServers: Array<{ name: string; createdAtUtc: string }>;
  disabledServers: Array<{ name: string }>;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[billing:email] RESEND_API_KEY not configured, skipping T-3 email");
    return false;
  }
  const title = "Your servers will be disabled in 3 days";
  const keptList = opts.keptServers.map((s) => `${s.name} (added ${s.createdAtUtc})`);
  const disabledList = opts.disabledServers.map((s) => s.name);
  const bodyHtml = `Hi ${escapeHtml(opts.firstName)},<br><br>` +
    `Quick reminder: your grace period ends in 3 days, on ${escapeHtml(opts.gracePeriodEndUtc)}. ` +
    `At that point, ${opts.disabledServers.length} of your servers will be disabled because no payment method is on file.<br><br>` +
    `<strong>These servers will stay active under the free quota (oldest 3):</strong>` +
    bulletList(keptList) +
    `<br><strong>These will be disabled:</strong>` +
    bulletList(disabledList) +
    `<br>Snapshots from disabled servers continue to be collected, so when you restore them you'll have full historical continuity.`;
  const html = billingEmailShell(title, bodyHtml, "Manage Subscription", SETTINGS_URL);
  const text = [
    `Hi ${opts.firstName},`,
    ``,
    `Quick reminder: your grace period ends in 3 days, on ${opts.gracePeriodEndUtc}. At that`,
    `point, ${opts.disabledServers.length} of your servers will be disabled because no payment method is on file.`,
    ``,
    `These servers will stay active under the free quota (oldest 3):`,
    plainBullet(keptList),
    ``,
    `These will be disabled:`,
    plainBullet(disabledList),
    ``,
    `Snapshots from disabled servers continue to be collected, so when you restore them you'll`,
    `have full historical continuity.`,
    ``,
    `To keep all servers active: ${SETTINGS_URL}`,
    ``,
    `Cheers,`,
    `The Glassmkr team`,
  ].join("\n");
  return sendBilling({
    to: opts.to,
    subject: "Your servers will be disabled in 3 days",
    html,
    text,
    label: "t3-reminder",
  });
}

/**
 * Email 3 — T-1 reminder. Sent 1 day before grace_period_end via the
 * daily email-reminders cron.
 */
export async function sendT1ReminderEmail(opts: {
  to: string;
  firstName: string;
  gracePeriodEndUtc: string;
  disabledServers: Array<{ name: string }>;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[billing:email] RESEND_API_KEY not configured, skipping T-1 email");
    return false;
  }
  const title = "Your servers will be disabled tomorrow";
  const disabledList = opts.disabledServers.map((s) => s.name);
  const bodyHtml = `Hi ${escapeHtml(opts.firstName)},<br><br>` +
    `Last reminder: your grace period ends tomorrow, ${escapeHtml(opts.gracePeriodEndUtc)}. ` +
    `${opts.disabledServers.length} servers will be disabled then unless a payment method is added.<br><br>` +
    `<strong>Affected servers:</strong>` +
    bulletList(disabledList);
  const html = billingEmailShell(title, bodyHtml, "Manage Subscription", SETTINGS_URL);
  const text = [
    `Hi ${opts.firstName},`,
    ``,
    `Last reminder: your grace period ends tomorrow, ${opts.gracePeriodEndUtc}.`,
    `${opts.disabledServers.length} servers will be disabled then unless a payment method is added.`,
    ``,
    `Affected servers:`,
    plainBullet(disabledList),
    ``,
    `${SETTINGS_URL}`,
    ``,
    `Cheers,`,
    `The Glassmkr team`,
  ].join("\n");
  return sendBilling({
    to: opts.to,
    subject: "Your servers will be disabled tomorrow",
    html,
    text,
    label: "t1-reminder",
  });
}

/**
 * Email 4 — Servers disabled. Sent immediately after the enforcement
 * cron suspends servers for a customer. One email per customer per
 * cron-cycle (NOT per-server).
 */
export async function sendServersDisabledEmail(opts: {
  to: string;
  firstName: string;
  disabledServers: Array<{ name: string }>;
  keptServers: Array<{ name: string }>;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[billing:email] RESEND_API_KEY not configured, skipping servers-disabled email");
    return false;
  }
  const title = "Some of your servers have been disabled";
  const disabledList = opts.disabledServers.map((s) => s.name);
  const keptList = opts.keptServers.map((s) => s.name);
  const bodyHtml = `Hi ${escapeHtml(opts.firstName)},<br><br>` +
    `${opts.disabledServers.length} of your servers were disabled today because no payment method is on file. ` +
    `Your oldest 3 stay active under the free quota.<br><br>` +
    `<strong>Disabled:</strong>` +
    bulletList(disabledList) +
    `<br><strong>Still active (free quota):</strong>` +
    bulletList(keptList) +
    `<br>Snapshots continue to be collected on disabled servers, so when you restore them you'll have full historical continuity. ` +
    `Alert delivery is paused for disabled servers until they're restored.<br><br>` +
    `To restore: add a card via Manage Subscription, then click Restore on each server in your dashboard.`;
  const html = billingEmailShell(title, bodyHtml, "Manage Subscription", SETTINGS_URL);
  const text = [
    `Hi ${opts.firstName},`,
    ``,
    `${opts.disabledServers.length} of your servers were disabled today because no payment method is on file.`,
    `Your oldest 3 stay active under the free quota.`,
    ``,
    `Disabled:`,
    plainBullet(disabledList),
    ``,
    `Still active (free quota):`,
    plainBullet(keptList),
    ``,
    `Snapshots continue to be collected on disabled servers, so when you restore them you'll have`,
    `full historical continuity. Alert delivery is paused for disabled servers until they're restored.`,
    ``,
    `To restore: ${SETTINGS_URL} to add a card, then click Restore on each server in your dashboard.`,
    ``,
    `Cheers,`,
    `The Glassmkr team`,
  ].join("\n");
  return sendBilling({
    to: opts.to,
    subject: "Some of your servers have been disabled",
    html,
    text,
    label: "servers-disabled",
  });
}

/** Internal Resend wrapper with consistent error handling. */
async function sendBilling(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  label: string;
}): Promise<boolean> {
  if (!resend) return false;
  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) {
      console.error(`[billing:email] ${opts.label} Resend error:`, error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[billing:email] ${opts.label} send failed:`, err?.message ?? err);
    return false;
  }
}

export async function sendPaymentFailedEmail(email: string): Promise<boolean> {
  if (!resend) {
    console.warn("[billing:email] RESEND_API_KEY not configured, skipping payment-failed email");
    return false;
  }

  const title = "Payment failed for your Glassmkr Pro subscription";
  const body = `We were unable to charge your card for your monthly Glassmkr Pro subscription. Stripe will retry a few times over the next weeks, but if the payment continues to fail your subscription will be cancelled and servers beyond the Free limit (3) will be suspended.<br><br>Please update your payment method to avoid interruption.`;
  const html = billingEmailShell(title, body, "Update Payment Method", "https://app.glassmkr.com/#settings");
  const text = [
    "Payment failed for your Glassmkr Pro subscription",
    "",
    "We were unable to charge your card for your monthly Glassmkr Pro subscription.",
    "Stripe will retry a few times over the next weeks, but if the payment",
    "continues to fail your subscription will be cancelled and servers beyond",
    "the Free limit (3) will be suspended.",
    "",
    "Update your payment method at: https://app.glassmkr.com/#settings",
  ].join("\n");

  try {
    const { error } = await resend.emails.send({
      from: "Glassmkr Billing <alerts@glassmkr.com>",
      to: email,
      subject: "Payment failed - please update your card",
      html,
      text,
    });
    if (error) {
      console.error("[billing:email] Resend error:", error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[billing:email] Send failed:", err.message);
    return false;
  }
}
