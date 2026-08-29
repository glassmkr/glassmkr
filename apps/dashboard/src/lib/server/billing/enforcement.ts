// Billing enforcement: identify customers whose grace period has expired
// (Pro plan, no card on file, billing period rolled over within the lookback
// window) and either suspend their servers above the free quota — or, if the
// feature flag is off, log what we would have done.
//
// The cron path here is the audit-by-production-code mechanism: while the
// flag is off, the soak-period log lines from `runEnforcementCycle` give us
// a continuously-updating list of which customers would be affected when the
// flag flips. Per Simon (session 13), this replaces the one-off SQL audit.
//
// Suspension semantics: oldest-3-stay (`ORDER BY created_at ASC`). Same
// ordering is used by the customer.subscription.deleted webhook handler
// post-fix in this PR, so both code paths produce the same "which 3 stay"
// result.
//
// All Stripe lookups are live (`stripe.subscriptions.retrieve` with
// `expand: ["default_payment_method"]`); we deliberately don't trust
// previously-stored flags, since a customer could have removed and re-added
// a card between the rollover trigger and this check.

import { query } from "@glassmkr/db/pg";
import { stripe, isStripeConfigured } from "./stripe";
import { isBillingEnforcementEnabled } from "./enforcement-flag";
import { suspendExcessServers } from "./suspension";
import { sendServersDisabledEmail } from "./email";

export interface EnforcementCandidate {
  customer_id: string;
  stripe_customer_id: string;
  active_server_count: number;
  servers_to_suspend: Array<{ id: string; name: string; created_at: Date }>;
  /** Grace-period-end the candidate query computed for this customer.
   *  Either the latest sub's `current_period_end` (Categories A/B) or
   *  `account.created_at + NO_SUB_GRACE_DAYS` (Category C). The cron
   *  only includes candidates whose grace_period_end <= NOW(). */
  grace_period_end: Date;
}

export interface EnforcementResult {
  flag_enabled: boolean;
  candidates: EnforcementCandidate[];
  suspended_count: number; // 0 when flag off
}

const FREE_QUOTA = 3;

/**
 * Number of days a brand-new Pro customer has, from account creation,
 * to add a payment method before the enforcement cron starts considering
 * them. Applies only to Category C (no Stripe subscription at all);
 * customers in Category A or B are bound by their subscription's
 * `current_period_end` instead.
 *
 * 30 days mirrors the typical Stripe trial-then-charge cadence and gives
 * customers who upgraded to Pro before completing checkout enough time
 * to either complete the flow or downgrade.
 */
const NO_SUB_GRACE_DAYS = 30;

/**
 * Find Pro customers whose grace period has elapsed and who don't have
 * a default payment method on file.
 *
 * "Grace period end" is computed per-customer:
 *   - If the customer has any `stripe_subscriptions` row, use the most
 *     recent (by `updated_at`) row's `current_period_end`. Captures both
 *     active subs (period_end in the future, NOT caught) and cancelled
 *     subs (period_end in the past, caught — Category B).
 *   - If the customer has no `stripe_subscriptions` row at all,
 *     fall back to `account.created_at + 30 days` (Category C, fixed in
 *     [#33](https://github.com/glassmkr/glassmkr/issues/33)).
 *
 * Originally this query INNER JOIN'd `stripe_subscriptions` and used a
 * narrow lookback window (`current_period_end` in the last 65 min). That
 * structurally missed Category C — Simon's account, the live example
 * that surfaced the bug. The LEFT JOIN LATERAL + COALESCE shape catches
 * all three categories. Idempotency is unchanged (the suspension helper
 * uses `COALESCE(suspended_at, NOW())` so re-running on already-suspended
 * rows preserves the original timestamp).
 *
 * `lookbackMs` is now unused for filtering — kept in the signature to
 * preserve the test surface and to allow future rate-limit knobs.
 */
export async function findEnforcementCandidates(_lookbackMs = 65 * 60 * 1000): Promise<EnforcementCandidate[]> {
  void _lookbackMs;
  if (!isStripeConfigured() || !stripe) return [];

  // bola-exempt: enumerates all customers whose grace period has
  // elapsed — this is a system-wide cron, not a customer request, so
  // a customer_id constraint would defeat the purpose. Both the outer
  // SELECT and the inner DISTINCT ON subquery are intentionally
  // cross-account.
  //
  // The DISTINCT ON subquery picks the most-recent stripe_subscriptions
  // row per customer (Postgres `DISTINCT ON (col) ... ORDER BY col, ...`
  // pattern). LEFT JOIN ensures customers with zero sub rows still
  // appear; the COALESCE in the SELECT and WHERE evaluates the
  // grace-period-end against `account.created_at + 30 days` for those.
  // bola-exempt: same rationale for the inner stripe_subscriptions scan.
  const candidatesRes = await query(
    `SELECT c.id AS customer_id,
            c.stripe_customer_id,
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
        AND NOT c.billing_enforcement_exempt
        AND NOT c.is_demo
        AND COALESCE(latest_sub.current_period_end,
                     c.created_at + INTERVAL '${NO_SUB_GRACE_DAYS} days') <= NOW()`,
    []
  );

  const out: EnforcementCandidate[] = [];

  for (const row of candidatesRes.rows) {
    let hasCard = false;
    try {
      const cust = await stripe.customers.retrieve(row.stripe_customer_id, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (cust && !(cust as any).deleted) {
        const dpm = (cust as any).invoice_settings?.default_payment_method;
        hasCard = !!dpm;
      }
    } catch (err: any) {
      // Conservative: on Stripe error we DON'T mark as candidate. Better
      // to under-suspend than over-suspend on transient API failures.
      console.warn(`[billing-enforcement] stripe lookup failed for ${row.stripe_customer_id}: ${err?.message ?? err}`);
      continue;
    }

    if (hasCard) continue;

    const serversRes = await query(
      `SELECT id, name, created_at FROM servers
        WHERE customer_id = $1 AND status = 'active'
        ORDER BY created_at ASC`,
      [row.customer_id]
    );
    const all = serversRes.rows as Array<{ id: string; name: string; created_at: Date }>;
    if (all.length <= FREE_QUOTA) continue;

    const toSuspend = all.slice(FREE_QUOTA);
    out.push({
      customer_id: row.customer_id,
      stripe_customer_id: row.stripe_customer_id,
      active_server_count: all.length,
      servers_to_suspend: toSuspend,
      grace_period_end: row.grace_period_end,
    });
  }

  return out;
}

/**
 * Run a single enforcement cycle. With the feature flag off (default),
 * logs `[billing-enforcement] would-suspend ...` lines and returns a
 * dry-run summary. With the flag on, executes the suspension.
 *
 * Caller controls scheduling (cron, manual invocation in tests).
 */
export async function runEnforcementCycle(): Promise<EnforcementResult> {
  const flagOn = isBillingEnforcementEnabled();

  // Cleanup pass (PR D): auto-restore servers belonging to customers
  // marked billing_enforcement_exempt AFTER their servers were suspended.
  // Without this, marking a customer exempt mid-cycle would leave their
  // servers stuck in suspended state until manually restored. The
  // cleanup pass resolves that automatically on the next cron firing.
  // Runs always — even with flag off — because it's the inverse of an
  // enforcement action and shouldn't be gated on the same flag.
  const cleanupRes = await query(
    // bola-exempt: cron-side; matches all exempt customers' suspended rows.
    `UPDATE servers s
        SET status = 'active',
            suspended_at = NULL,
            suspended_reason = NULL
       FROM customers c
      WHERE s.customer_id = c.id
        AND c.billing_enforcement_exempt = TRUE
        AND s.status = 'suspended'
      RETURNING s.id, s.customer_id`
  );
  if (cleanupRes.rows.length > 0) {
    const byCustomer = new Map<string, string[]>();
    for (const r of cleanupRes.rows as Array<{ id: string; customer_id: string }>) {
      const list = byCustomer.get(r.customer_id) ?? [];
      list.push(r.id);
      byCustomer.set(r.customer_id, list);
    }
    for (const [cid, ids] of byCustomer) {
      console.log(`[billing-enforcement] cleanup-exempt customer=${cid} servers=[${ids.join(",")}]`);
    }
  }

  const candidates = await findEnforcementCandidates();

  if (candidates.length === 0) {
    console.log(`[billing-enforcement] cycle complete flag=${flagOn} candidates=0 suspended=0`);
    return { flag_enabled: flagOn, candidates, suspended_count: 0 };
  }

  let suspendedCount = 0;
  for (const c of candidates) {
    const ids = c.servers_to_suspend.map((s) => s.id);
    if (!flagOn) {
      // Audit-only line. Includes the customer id, the count, and the
      // server-id list (small set — bounded by per-customer server count;
      // typical case is 1-5 ids). No customer email or PII surfaced.
      console.log(
        `[billing-enforcement] would-suspend customer=${c.customer_id} stripe=${c.stripe_customer_id} active=${c.active_server_count} suspending=${ids.length} server_ids=${ids.join(",")}`
      );
      continue;
    }
    // Flag on — actually suspend via the shared helper. The helper
    // re-fetches active servers and re-applies the `created_at ASC`
    // ordering. There's a tiny race here (a server could have been
    // added/removed between findEnforcementCandidates and now); the
    // helper handles it correctly because it's idempotent and re-reads.
    const result = await suspendExcessServers(c.customer_id, FREE_QUOTA, "no_card_on_file");
    suspendedCount += result.suspended_ids.length;
    console.log(
      `[billing-enforcement] suspended customer=${c.customer_id} count=${result.suspended_ids.length} server_ids=${result.suspended_ids.join(",")} reason=no_card_on_file`
    );

    // Email 4 — Servers disabled. One email per customer per cycle.
    // Best-effort: a Resend failure logs but doesn't block enforcement.
    if (result.suspended_ids.length > 0) {
      try {
        const emailRes = await query(
          `SELECT email, display_name FROM customers WHERE id = $1`,
          [c.customer_id],
        );
        const ec = emailRes.rows[0] as { email: string | null; display_name: string | null } | undefined;
        if (ec?.email) {
          const fname = (ec.display_name && ec.display_name.trim().split(/\s+/)[0]) || ec.email.split("@")[0] || "there";
          // Re-fetch the post-suspension state to surface the right
          // disabled / kept lists by name.
          const namesRes = await query(
            `SELECT id, name, status FROM servers
              WHERE customer_id = $1
              ORDER BY created_at ASC`,
            [c.customer_id],
          );
          const all = namesRes.rows as Array<{ id: string; name: string; status: string }>;
          const disabledNames = all.filter((s) => result.suspended_ids.includes(s.id)).map((s) => ({ name: s.name }));
          const keptNames = all.filter((s) => result.kept_ids.includes(s.id)).map((s) => ({ name: s.name }));
          const ok = await sendServersDisabledEmail({
            to: ec.email,
            firstName: fname,
            disabledServers: disabledNames,
            keptServers: keptNames,
          });
          console.log(`[billing-enforcement] servers-disabled-email customer=${c.customer_id} ok=${ok}`);
        }
      } catch (err: any) {
        console.error(`[billing-enforcement] servers-disabled-email send failed customer=${c.customer_id}: ${err?.message ?? err}`);
      }
    }
  }

  console.log(`[billing-enforcement] cycle complete flag=${flagOn} candidates=${candidates.length} suspended=${suspendedCount}`);
  return { flag_enabled: flagOn, candidates, suspended_count: suspendedCount };
}
