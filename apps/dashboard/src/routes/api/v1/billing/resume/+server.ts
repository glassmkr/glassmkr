// scope: admin
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { stripe, isStripeConfigured } from "$lib/server/billing/stripe";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

// POST /api/v1/billing/resume - clear a scheduled cancellation.
//
// Single-click action; no confirmation page (lower-risk than the cancel
// path). If the subscription is not scheduled to cancel, this is a no-op
// that returns success.
export const POST: RequestHandler = async (event) => {
  // Session-only by design (no acct_key path on billing flows).
  const principal = await requireAuth(event, { allow: ["session"] });
  requireScopeLevel(principal, "admin");

  try {
    const customerId = principal.customer_id;
    const r = await query(
      `SELECT stripe_subscription_id FROM customers WHERE id = $1`,
      [customerId],
    );
    const subId = r.rows[0]?.stripe_subscription_id;
    if (!subId) {
      return json({ error: "No active subscription to resume" }, { status: 400 });
    }
    if (!stripe || !isStripeConfigured()) {
      return json({ error: "Billing not configured" }, { status: 503 });
    }
    const sub = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: false,
    });
    console.log(`[billing] Customer ${customerId} resumed subscription ${subId}`);
    return json({
      success: true,
      cancel_at_period_end: false,
      current_period_end: (() => {
        const cpe = (sub as any).current_period_end
          ?? sub.items?.data?.[0]?.current_period_end;
        return typeof cpe === "number" ? new Date(cpe * 1000).toISOString() : null;
      })(),
    });
  } catch (err: any) {
    const msg = err?.raw?.message || err?.message || "Failed to resume subscription";
    console.error(`[billing:resume] customer=${principal.customer_id} error=${msg}`);
    return json({ error: msg }, { status: 500 });
  }
};
