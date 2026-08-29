// scope: write
// POST /api/v1/servers/restore-all
//
// Bulk-restore every server the authenticated customer has in
// `status='suspended' AND suspended_reason='no_card_on_file'`.
//
// Why bulk-and-not-per-server: restoring is a pay-or-shrink decision
// at the customer level, not a per-server one. Once the customer adds
// a card, they want all their disabled servers active. Per-row buttons
// are tedious for the operator and make the actual decision (pay) less
// visible. Per-server Delete still exists in the UI; that one IS
// per-server because a customer might delete some old test servers
// while restoring others.
//
// One Stripe live-check up front (vs. one per server in a loop). One
// transaction. Atomic. Returns the list of restored server IDs.
//
// Exempt customers: skip Stripe check entirely. Mirrors the
// /servers/{id}/restore single-server semantics.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import { requireProTierForAcctKey, requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import {
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import { stripe, isStripeConfigured } from "$lib/server/billing/stripe";
import { isBillingEnforcementEnabled } from "$lib/server/billing/enforcement-flag";
import type { Principal } from "$lib/server/auth/principal";

export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "restore-all",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, {
      allow: ["session", "acct_key"],
    });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "restore-all",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
    });
    throw err;
  }

  // Pro-tier gate for programmatic callers. Sessions bypass so a
  // Free customer can still bulk-restore from the dashboard after
  // fixing payment. Closes the leak surfaced by the free-tier audit
  // on 2026-05-13.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "restore-all",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: bulk restore is `write` (same as
  // per-server restore).
  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "restore-all",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  // Flag-off short-circuit. Mirrors the per-server endpoint's 503.
  if (!isBillingEnforcementEnabled()) {
    void writeAudit({
      event,
      principal,
      action: "restore-all",
      result: "error",
      status_code: 503,
      resource_type: "server",
      metadata: { reason: "feature_flag_off" },
    });
    return json(
      { error: "Billing enforcement not yet active. Server restoration is not available." },
      { status: 503 },
    );
  }

  // Customer record + exemption check. Exempt customers skip the live
  // Stripe card-check. Same shape as the per-server endpoint.
  const custRes = await query(
    `SELECT stripe_customer_id, billing_enforcement_exempt FROM customers WHERE id = $1`,
    [principal.customer_id],
  );
  const stripeCustomerId = custRes.rows[0]?.stripe_customer_id as string | undefined;
  const isExempt = !!custRes.rows[0]?.billing_enforcement_exempt;

  // Find the customer's suspended-no-card servers up-front. If none,
  // return cleanly without further work.
  const suspendedRes = await query(
    `SELECT id, name FROM servers
      WHERE customer_id = $1
        AND status = 'suspended'
        AND suspended_reason = 'no_card_on_file'
      ORDER BY created_at ASC`,
    [principal.customer_id],
  );
  const suspended = suspendedRes.rows as Array<{ id: string; name: string }>;
  if (suspended.length === 0) {
    return json({ success: true, restored: [], already_active: true });
  }

  if (!isExempt) {
    if (!isStripeConfigured() || !stripe) {
      return json({ error: "stripe_not_configured" }, { status: 503 });
    }
    if (!stripeCustomerId) {
      return json(
        { error: "no_stripe_customer", message: "No Stripe customer record. Add a payment method via Manage Subscription before restoring servers." },
        { status: 400 },
      );
    }
    let hasCard = false;
    try {
      const cust = await stripe.customers.retrieve(stripeCustomerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (cust && !(cust as any).deleted) {
        const dpm = (cust as any).invoice_settings?.default_payment_method;
        hasCard = !!dpm;
      }
    } catch (err: any) {
      console.warn(`[billing-enforcement] restore-all stripe-lookup failed customer=${principal.customer_id}: ${err?.message ?? err}`);
      return json({ error: "stripe_lookup_failed" }, { status: 502 });
    }
    if (!hasCard) {
      return json(
        { error: "no_card_on_file", message: "Add a payment method via Manage Subscription before restoring servers." },
        { status: 400 },
      );
    }
  }

  // Bulk UPDATE — one statement, customer-scoped. The status +
  // suspended_reason filter ensures we only flip rows matching the
  // exact intended set (defends against a TOCTOU where a row was
  // restored or deleted between our SELECT and this UPDATE).
  // BOLA defence: customer_id constraint duplicates ownership check.
  const updateRes = await query(
    `UPDATE servers
        SET status = 'active',
            suspended_at = NULL,
            suspended_reason = NULL
      WHERE customer_id = $1
        AND status = 'suspended'
        AND suspended_reason = 'no_card_on_file'
      RETURNING id, name`,
    [principal.customer_id],
  );
  const restored = updateRes.rows as Array<{ id: string; name: string }>;

  void writeAudit({
    event,
    principal,
    action: "restore-all",
    result: "success",
    status_code: 200,
    resource_type: "server",
    metadata: { restored_count: restored.length, exempt: isExempt },
  });

  console.log(
    `[billing-enforcement] restored-all customer=${principal.customer_id} count=${restored.length} server_ids=${restored.map((s) => s.id).join(",")} exempt=${isExempt}`,
  );

  return json({
    success: true,
    restored,
    count: restored.length,
    message: `${restored.length} server${restored.length === 1 ? "" : "s"} restored.`,
  });
};
