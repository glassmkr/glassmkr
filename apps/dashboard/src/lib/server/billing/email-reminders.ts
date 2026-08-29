// Daily cron that sends T-3 and T-1 grace-period reminder emails.
//
// Trigger: scheduled at 06:00 UTC daily (matches the typical morning
// inbox-arrival cadence). For each Pro customer with grace_period_end
// in the windows [NOW+3d, NOW+3d+24h) (T-3) and [NOW+1d, NOW+1d+24h)
// (T-1), send the corresponding reminder.
//
// Gating:
//   - Whole module is a no-op if RESEND_API_KEY is unset.
//   - Sends are gated on BILLING_ENFORCEMENT_ENABLED at runtime; with
//     the flag off, we log "[email-reminders] would-send" instead of
//     calling Resend. Same audit-by-production-code shape the
//     enforcement cron uses.
//   - Skips customers without an `email` value (defensive).
//   - Skips customers marked `billing_enforcement_exempt` (PR D).
//
// Idempotency: the windowing is 24h-wide and the cron runs daily, so
// each customer triggers a given reminder at most once per grace cycle.
// If the cron skips (process restart) and runs late in the same day,
// the same window catches the customer again — Resend would send a
// duplicate. We accept that single-day duplication risk in exchange for
// not maintaining a dedicated `email_reminders_sent` ledger; the
// underlying enforcement cron's idempotency rules out double-suspension
// regardless.

import { query } from "@glassmkr/db/pg";
import { isStripeConfigured } from "./stripe";
import { isBillingEnforcementEnabled } from "./enforcement-flag";
import {
  sendT3ReminderEmail,
  sendT1ReminderEmail,
} from "./email";

const NO_SUB_GRACE_DAYS = 30;
const FREE_QUOTA = 3;

interface ReminderCandidate {
  customer_id: string;
  email: string;
  display_name: string | null;
  grace_period_end: Date;
}

interface ServerRow { id: string; name: string; created_at: Date }

function firstName(displayName: string | null, email: string): string {
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0];
  const local = email.split("@")[0] ?? "there";
  return local.length > 0 ? local : "there";
}

function formatUtc(d: Date): string {
  // YYYY-MM-DD HH:MM UTC, no seconds — calmer reading than ISO 8601.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Find candidates whose grace_period_end falls in [now+lowerDays,
 * now+lowerDays+1d). Excludes exempt customers — the enforcement
 * scheduler already skips them, so the reminder cron must skip them
 * too or staff / comp accounts get T-3 / T-1 "card missing" emails
 * for a suspension that will never fire. Codex 2026-05-12 P2.
 */
async function findCandidates(lowerDays: number): Promise<ReminderCandidate[]> {
  // bola-exempt: cron-side enumeration of all matching customers; the
  // SELECT is intentionally not customer-scoped.
  const r = await query(
    `SELECT c.id::text AS customer_id,
            c.email,
            c.display_name,
            COALESCE(latest_sub.current_period_end,
                     c.created_at + INTERVAL '${NO_SUB_GRACE_DAYS} days') AS grace_period_end
       FROM customers c
       LEFT JOIN (
         SELECT DISTINCT ON (glassmkr_customer_id)
                glassmkr_customer_id,
                current_period_end
           FROM stripe_subscriptions
          ORDER BY glassmkr_customer_id, updated_at DESC
       ) latest_sub ON latest_sub.glassmkr_customer_id = c.id
      WHERE c.plan = 'pro'
        AND c.stripe_customer_id IS NOT NULL
        AND c.email IS NOT NULL AND c.email <> ''
        AND NOT COALESCE(c.billing_enforcement_exempt, false)
        AND COALESCE(latest_sub.current_period_end,
                     c.created_at + INTERVAL '${NO_SUB_GRACE_DAYS} days')
            >= NOW() + ($1::int * INTERVAL '1 day')
        AND COALESCE(latest_sub.current_period_end,
                     c.created_at + INTERVAL '${NO_SUB_GRACE_DAYS} days')
            <  NOW() + ($1::int * INTERVAL '1 day') + INTERVAL '1 day'`,
    [lowerDays]
  );
  return r.rows as ReminderCandidate[];
}

async function loadServers(customerId: string): Promise<ServerRow[]> {
  const r = await query(
    `SELECT id, name, created_at FROM servers
      WHERE customer_id = $1 AND status = 'active'
      ORDER BY created_at ASC`,
    [customerId]
  );
  return r.rows as ServerRow[];
}

export interface ReminderCycleResult {
  flag_enabled: boolean;
  t3_sent: number;
  t3_would_send: number;
  t1_sent: number;
  t1_would_send: number;
}

/**
 * Run a single reminder cycle. Caller controls scheduling.
 *
 * Note: this function does NOT check Stripe per candidate. The
 * grace_period_end window already encodes intent — a customer in the
 * T-3 or T-1 window with no card on file (and >3 servers) is the same
 * candidate the enforcement cron will catch on rollover. If a card has
 * been added between this email and the rollover, the enforcement cron
 * will live-check Stripe and drop the candidate; the worst-case here
 * is a redundant T-3 / T-1 email to a customer who's already added
 * a card. Acceptable noise vs. duplicating Stripe-call complexity.
 */
export async function runReminderCycle(): Promise<ReminderCycleResult> {
  if (!isStripeConfigured()) {
    console.log(`[email-reminders] cycle skipped: stripe not configured`);
    return { flag_enabled: false, t3_sent: 0, t3_would_send: 0, t1_sent: 0, t1_would_send: 0 };
  }

  const flagOn = isBillingEnforcementEnabled();
  let t3Sent = 0;
  let t3WouldSend = 0;
  let t1Sent = 0;
  let t1WouldSend = 0;

  for (const [lowerDays, label] of [[3, "t3"], [1, "t1"]] as const) {
    const candidates = await findCandidates(lowerDays);
    for (const c of candidates) {
      const servers = await loadServers(c.customer_id);
      if (servers.length <= FREE_QUOTA) continue; // wouldn't actually be suspended

      const kept = servers.slice(0, FREE_QUOTA).map((s) => ({ name: s.name, createdAtUtc: formatDateOnly(s.created_at) }));
      const disabled = servers.slice(FREE_QUOTA).map((s) => ({ name: s.name }));
      const fname = firstName(c.display_name, c.email);
      const graceEnd = formatUtc(c.grace_period_end);

      if (!flagOn) {
        console.log(
          `[email-reminders] would-send ${label} customer=${c.customer_id} grace_period_end=${graceEnd} disabled_count=${disabled.length}`
        );
        if (label === "t3") t3WouldSend++;
        else t1WouldSend++;
        continue;
      }

      // Flag on — actually send.
      let ok = false;
      if (label === "t3") {
        ok = await sendT3ReminderEmail({
          to: c.email,
          firstName: fname,
          gracePeriodEndUtc: graceEnd,
          keptServers: kept,
          disabledServers: disabled,
        });
        if (ok) t3Sent++;
      } else {
        ok = await sendT1ReminderEmail({
          to: c.email,
          firstName: fname,
          gracePeriodEndUtc: graceEnd,
          disabledServers: disabled,
        });
        if (ok) t1Sent++;
      }
      console.log(
        `[email-reminders] sent ${label} customer=${c.customer_id} grace_period_end=${graceEnd} ok=${ok}`
      );
    }
  }

  console.log(
    `[email-reminders] cycle complete flag=${flagOn} t3_sent=${t3Sent} t3_would_send=${t3WouldSend} t1_sent=${t1Sent} t1_would_send=${t1WouldSend}`
  );
  return { flag_enabled: flagOn, t3_sent: t3Sent, t3_would_send: t3WouldSend, t1_sent: t1Sent, t1_would_send: t1WouldSend };
}
