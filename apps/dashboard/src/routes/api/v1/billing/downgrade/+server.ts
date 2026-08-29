// scope: admin
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { stripe, isStripeConfigured, PLAN_LIMITS } from "$lib/server/billing/stripe";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

// POST /api/v1/billing/downgrade - voluntarily drop to Free.
//
// Two cases:
//   - Pro customer with an active Stripe subscription: schedule the
//     cancellation at period end (cancel_at_period_end=true). DB stays on
//     Pro; access continues until the period ends; subscription.deleted
//     webhook fires at period end and downgrades to Free + suspends
//     excess servers. The customer is NOT charged the next period and is
//     NOT refunded for the current period (per docs/billing-policy).
//   - Pro customer with no subscription (lazy state, 0 active nodes):
//     immediately downgrade plan in DB and suspend excess servers. There
//     is no Stripe sub to schedule; the customer never paid.
//
// EU Directive 2023/2673 requires a one- or two-click in-app cancel; this
// endpoint is the click-2 backend. See CC_BILLING_POLICY_AND_CANCEL_FUNCTION.md.
export const POST: RequestHandler = async (event) => {
  // Session-only by design (no acct_key path on billing flows).
  const principal = await requireAuth(event, { allow: ["session"] });
  requireScopeLevel(principal, "admin");

  try {
    const customerId = principal.customer_id;
    const result = await query(
      `SELECT plan, stripe_subscription_id FROM customers WHERE id = $1`,
      [customerId]
    );
    const c = result.rows[0];
    if (!c) return json({ error: "Customer not found" }, { status: 404 });

    if (c.plan === "free") {
      return json({ success: true, message: "Already on Free plan" });
    }
    if (c.plan === "enterprise") {
      return json({ error: "Enterprise plans require contacting support to change" }, { status: 400 });
    }

    // If the customer has a stripe_subscription_id we MUST be able to
    // talk to Stripe; otherwise we'd silently downgrade the local plan
    // while the remote subscription keeps billing. Codex review
    // 2026-05-05 flagged this as a should-fix. Treat "has sub but
    // Stripe unavailable" as a hard error rather than falling into
    // the lazy-state path below.
    if (c.stripe_subscription_id && (!stripe || !isStripeConfigured())) {
      console.error(
        `[billing:downgrade] customer=${customerId} has stripe_subscription_id=${c.stripe_subscription_id} but Stripe is not configured; refusing to downgrade locally`,
      );
      return json(
        { error: "Billing is temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    if (c.stripe_subscription_id) {
      // Active subscription: schedule cancellation at period end. Customer
      // keeps Pro until then, no refund issued. The actual plan downgrade
      // and server suspension happen when subscription.deleted fires.
      const sub = await stripe!.subscriptions.update(c.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      const cpe = (sub as any).current_period_end
        ?? sub.items?.data?.[0]?.current_period_end;
      const periodEnd = typeof cpe === "number"
        ? new Date(cpe * 1000).toISOString()
        : null;
      console.log(`[billing] Customer ${customerId} scheduled cancellation at period end (sub ${sub.id}, ends ${periodEnd ?? "?"})`);
      return json({
        success: true,
        scheduled: true,
        message: "Cancellation scheduled",
        cancel_at_period_end: true,
        current_period_end: periodEnd,
        cancelled_subscription_id: c.stripe_subscription_id,
        suspended: 0,
      });
    }

    // Lazy state (Pro, no sub). No Stripe call required; immediate drop.
    const limits = PLAN_LIMITS.free;
    await query(
      `UPDATE customers SET plan = 'free', stripe_subscription_id = NULL,
       plan_server_limit = $1, plan_retention_days = $2, plan_managed_alerts = $3,
       plan_updated_at = NOW() WHERE id = $4`,
      [limits.server_limit, limits.retention_days, limits.managed_alerts, customerId]
    );

    const activeServers = await query(
      `SELECT id FROM servers WHERE customer_id = $1 AND status = 'active' ORDER BY last_seen_at DESC NULLS LAST`,
      [customerId]
    );
    let suspended = 0;
    if (activeServers.rows.length > limits.server_limit) {
      const toSuspend = activeServers.rows.slice(limits.server_limit).map((r: any) => r.id);
      // bola-exempt: toSuspend ids were sliced from a customer-scoped
      // query above (activeServers WHERE customer_id = $1).
      await query(
        `UPDATE servers SET status = 'suspended' WHERE id = ANY($1::text[])`,
        [toSuspend]
      );
      suspended = toSuspend.length;
    }

    console.log(`[billing] Customer ${customerId} downgraded to free immediately (lazy state, no sub)`);
    return json({
      success: true,
      scheduled: false,
      message: "Downgraded to Free plan",
      cancelled_subscription_id: null,
      suspended,
    });
  } catch (err: any) {
    const stripeMessage = err?.raw?.message || err?.message || "Failed to downgrade";
    console.error(`[billing:downgrade] customer=${principal.customer_id} error=${stripeMessage}`);
    return json({ error: stripeMessage }, { status: 500 });
  }
};
