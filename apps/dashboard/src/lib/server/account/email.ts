// Account-keys email cascade (Phase 4): T-7, T-1, and post-expiry
// notifications. Reuses `glassmkrEmailShell` from the billing module
// so the visual brand stays consistent; only the category badge,
// subject lines, and bodies are account-flavoured.
//
// All three degrade-open if RESEND_API_KEY is unset (log, return
// false). Sent by the daily key-expiry cron in
// `account/key-expiry.ts` after it identifies which keys are due
// for which stage.

import { Resend } from "resend";
import { glassmkrEmailShell } from "$lib/server/billing/email";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const DASHBOARD_HOST = process.env.DASHBOARD_PUBLIC_URL || "https://app.glassmkr.com";
const KEYS_URL = `${DASHBOARD_HOST}/settings/keys`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fromAddress(): string {
  return "Glassmkr Account <alerts@glassmkr.com>";
}

// Dedicated sender for password-reset (security) mail, kept separate from the
// account/alerts sender above. Same verified glassmkr.com domain.
const PASSWORD_RESET_FROM = "Glassmkr <no-reply@glassmkr.com>";

function detailsBlock(name: string, prefix: string, scope: string, when: string): string {
  return `<div style="margin-top:14px;padding:12px 14px;background-color:#0B0C0E;border:1px solid #313742;border-radius:6px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;color:#A2A9B4;line-height:1.7;">
  <div><strong style="color:#ECEEF1;">Name:</strong> ${escapeHtml(name)}</div>
  <div><strong style="color:#ECEEF1;">Prefix:</strong> ${escapeHtml(prefix)}</div>
  <div><strong style="color:#ECEEF1;">Scope:</strong> ${escapeHtml(scope)}</div>
  <div><strong style="color:#ECEEF1;">Expires:</strong> ${escapeHtml(when)}</div>
</div>`;
}

export interface KeyExpiryEmailContext {
  email: string;
  firstName: string;
  keyName: string;
  prefix: string;
  scope: string;
  expiresAt: Date;
}

function formatRelativeFromNow(target: Date, now: Date = new Date()): string {
  const diffMs = target.getTime() - now.getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today";
  return `${Math.abs(days)} days ago`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---- Email A: T-7 (seven days before expiry) ------------------------

export async function sendKeyExpiringT7(ctx: KeyExpiryEmailContext): Promise<boolean> {
  if (!resend) {
    console.warn("[account-keys] T-7 email: RESEND_API_KEY unset, skipping");
    return false;
  }
  const subject = `Your API key '${ctx.keyName}' expires in 7 days`;
  const body =
    `<p>Hi ${escapeHtml(ctx.firstName)},</p>` +
    `<p>Your API key <strong>${escapeHtml(ctx.keyName)}</strong> will expire on ` +
    `${escapeHtml(isoDate(ctx.expiresAt))} (${formatRelativeFromNow(ctx.expiresAt)}).</p>` +
    `<p>If you no longer need this key, you can let it expire automatically. ` +
    `If your automation depends on it, rotate it before expiry to avoid ` +
    `service interruption.</p>` +
    detailsBlock(ctx.keyName, ctx.prefix, ctx.scope, `${isoDate(ctx.expiresAt)} (${formatRelativeFromNow(ctx.expiresAt)})`);
  const html = glassmkrEmailShell({
    category: "Account",
    title: `API key '${ctx.keyName}' expires in 7 days`,
    body,
    ctaText: "Manage keys",
    ctaUrl: KEYS_URL,
  });
  try {
    await resend.emails.send({ from: fromAddress(), to: ctx.email, subject, html });
    return true;
  } catch (err: any) {
    console.error("[account-keys] T-7 send error:", err?.message ?? err);
    return false;
  }
}

// ---- Email B: T-1 (one day before expiry) ---------------------------

export async function sendKeyExpiringT1(ctx: KeyExpiryEmailContext): Promise<boolean> {
  if (!resend) {
    console.warn("[account-keys] T-1 email: RESEND_API_KEY unset, skipping");
    return false;
  }
  const subject = `Your API key '${ctx.keyName}' expires tomorrow`;
  const body =
    `<p>Hi ${escapeHtml(ctx.firstName)},</p>` +
    `<p>Heads-up: your API key <strong>${escapeHtml(ctx.keyName)}</strong> ` +
    `expires tomorrow (${escapeHtml(isoDate(ctx.expiresAt))}). Rotate now ` +
    `if your automation still needs to use it after that, or let it expire ` +
    `cleanly if it's no longer in use.</p>` +
    detailsBlock(ctx.keyName, ctx.prefix, ctx.scope, `${isoDate(ctx.expiresAt)} (tomorrow)`);
  const html = glassmkrEmailShell({
    category: "Account",
    title: `API key '${ctx.keyName}' expires tomorrow`,
    body,
    ctaText: "Rotate or create new key",
    ctaUrl: KEYS_URL,
  });
  try {
    await resend.emails.send({ from: fromAddress(), to: ctx.email, subject, html });
    return true;
  } catch (err: any) {
    console.error("[account-keys] T-1 send error:", err?.message ?? err);
    return false;
  }
}

// ---- Email C: post-expiry (after cron revokes) ----------------------

export async function sendKeyExpired(ctx: KeyExpiryEmailContext): Promise<boolean> {
  if (!resend) {
    console.warn("[account-keys] expired email: RESEND_API_KEY unset, skipping");
    return false;
  }
  const subject = `Your API key '${ctx.keyName}' has expired`;
  const body =
    `<p>Hi ${escapeHtml(ctx.firstName)},</p>` +
    `<p>Your API key <strong>${escapeHtml(ctx.keyName)}</strong> expired on ` +
    `${escapeHtml(isoDate(ctx.expiresAt))} and has been revoked.</p>` +
    `<p>Any automation using this key will now return 401 errors until you ` +
    `create a replacement.</p>` +
    detailsBlock(ctx.keyName, ctx.prefix, ctx.scope, `${isoDate(ctx.expiresAt)}`);
  const html = glassmkrEmailShell({
    category: "Account",
    title: `API key '${ctx.keyName}' has expired`,
    body,
    ctaText: "Create new key",
    ctaUrl: KEYS_URL,
  });
  try {
    await resend.emails.send({ from: fromAddress(), to: ctx.email, subject, html });
    return true;
  } catch (err: any) {
    console.error("[account-keys] expired send error:", err?.message ?? err);
    return false;
  }
}

// ---- Password reset -------------------------------------------------

export async function sendPasswordReset(
  email: string,
  displayName: string | null,
  resetUrl: string,
): Promise<boolean> {
  if (!resend) {
    console.warn("[account] password-reset email: RESEND_API_KEY unset, skipping");
    return false;
  }
  const firstName = (displayName || "").trim().split(/\s+/)[0] || "there";
  const subject = "Reset your Glassmkr password";
  const body =
    `<p>Hi ${escapeHtml(firstName)},</p>` +
    `<p>We received a request to reset the password for the Glassmkr account ` +
    `<strong>${escapeHtml(email)}</strong>. Choose a new password with the button ` +
    `below. This link expires in 30 minutes and can be used once.</p>` +
    `<p>If you didn't request this, you can safely ignore this email; your ` +
    `password won't change.</p>`;
  const html = glassmkrEmailShell({
    category: "Account",
    title: "Reset your password",
    body,
    ctaText: "Reset password",
    ctaUrl: resetUrl,
  });
  try {
    // Dedicated transactional sender for security mail (distinct from the
    // account/alerts sender). Same verified glassmkr.com domain, so no extra
    // Resend/DNS setup is required.
    await resend.emails.send({ from: PASSWORD_RESET_FROM, to: email, subject, html });
    return true;
  } catch (err: any) {
    console.error("[account] password-reset send error:", err?.message ?? err);
    return false;
  }
}
