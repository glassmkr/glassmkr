// scope: read
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { stripe, isStripeConfigured, computeMonthlyCost, billableNodes, PRICE_PER_NODE_USD, FREE_NODES_PRO } from "$lib/server/billing/stripe";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

export const GET: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");

  try {
    const result = await query(
      `SELECT plan, stripe_customer_id, stripe_subscription_id, plan_server_limit, plan_retention_days, plan_managed_alerts FROM customers WHERE id = $1`,
      [principal.customer_id]
    );
    if (result.rows.length === 0) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    const c = result.rows[0];
    const serverCount = await query(
      `SELECT COUNT(*) FROM servers WHERE customer_id = $1 AND status = 'active'`,
      [principal.customer_id]
    );
    const serversUsed = parseInt(serverCount.rows[0].count, 10);

    // Count of servers suspended specifically for `no_card_on_file`. Drives
    // the State 2 dunning banner ("[N] of your [M] servers are currently
    // disabled..."). Other suspension reasons (e.g. subscription_cancelled
    // from a downgrade) don't drive the same UI; they're operationally
    // different and the customer is already on Free at that point.
    const suspendedRes = await query(
      `SELECT COUNT(*) FROM servers
        WHERE customer_id = $1 AND status = 'suspended' AND suspended_reason = 'no_card_on_file'`,
      [principal.customer_id]
    );
    const suspendedNoCardCount = parseInt(suspendedRes.rows[0].count, 10);
    const plan = c.plan || "free";
    const monthlyCost = computeMonthlyCost(plan, serversUsed);

    // Fetch live subscription state from Stripe so the UI can surface
    // payment problems (no card on file, past_due, unpaid) immediately
    // instead of waiting for Stripe to eventually cancel and downgrade.
    let subscriptionStatus: string | null = null;
    let hasDefaultPaymentMethod: boolean | null = null;
    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: string | null = null;
    if (stripe && c.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(c.stripe_subscription_id, {
          expand: ["default_payment_method"],
        });
        subscriptionStatus = sub.status;
        hasDefaultPaymentMethod = !!sub.default_payment_method;
        cancelAtPeriodEnd = !!sub.cancel_at_period_end;
        // current_period_end is still returned by the Stripe API at runtime
        // but newer SDK types have moved it under subscription items. Cast
        // to access it without a typegen change.
        const cpe = (sub as any).current_period_end
          ?? sub.items?.data?.[0]?.current_period_end;
        currentPeriodEnd = typeof cpe === "number"
          ? new Date(cpe * 1000).toISOString()
          : null;
      } catch (err: any) {
        // Subscription was deleted on Stripe's side or key lacks read perms.
        // Fall through; the UI will treat null as "unknown" and not block.
        console.warn(`[billing:status] sub retrieve failed for ${c.stripe_subscription_id}:`, err?.message);
      }
    }
    if (stripe && c.stripe_customer_id && hasDefaultPaymentMethod === null) {
      // No active sub but customer exists; check whether they have a saved card
      // (relevant for the "Pro with 0 servers, lazy state" case).
      try {
        const sc = await stripe.customers.retrieve(c.stripe_customer_id);
        if (sc && !sc.deleted) {
          hasDefaultPaymentMethod = !!sc.invoice_settings?.default_payment_method;
        }
      } catch (err: any) {
        console.warn(`[billing:status] customer retrieve failed for ${c.stripe_customer_id}:`, err?.message);
      }
    }

    return json({
      plan,
      server_limit: c.plan_server_limit || 3,
      retention_days: c.plan_retention_days || 7,
      managed_alerts: c.plan_managed_alerts || false,
      servers_used: serversUsed,
      stripe_configured: isStripeConfigured(),
      has_subscription: !!c.stripe_subscription_id,
      subscription_status: subscriptionStatus,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: currentPeriodEnd,
      has_default_payment_method: hasDefaultPaymentMethod,
      monthly_cost_usd: monthlyCost,
      price_per_node_usd: PRICE_PER_NODE_USD,
      billable_nodes: plan === "pro" ? billableNodes(serversUsed) : 0,
      free_nodes_quota: FREE_NODES_PRO,
      suspended_no_card_count: suspendedNoCardCount,
    });
  } catch (err: any) {
    console.error("Billing status error:", err.message);
    return json({ error: "Failed to get billing status" }, { status: 500 });
  }
};
