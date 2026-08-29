import { query } from "@glassmkr/db/pg";
import { stripe } from "./stripe";

export interface SyncResult {
  action: "none" | "updated" | "cancelled" | "skipped";
  billable: number;
  subscriptionId: string | null;
  reason?: string;
}

/**
 * Sync the customer's Stripe subscription quantity with their current billable node count.
 *
 * Called after server add/delete and after checkout completion. Idempotent and safe
 * to call repeatedly. Uses proration on every update so mid-cycle changes are
 * charged/credited for the actual time used.
 *
 * State machine (legacy Pro customers only; non-Pro is a no-op):
 *   billable === 0, no sub        -> no-op
 *   billable === 0, sub exists    -> cancel sub (prorated credit)
 *   billable > 0,  no sub         -> REFUSED (subscription creation is retired)
 *   billable > 0,  sub exists     -> update sub quantity=billable (prorated)
 *
 * Creation is retired with the paid tier (P0-03, ground-truth.yaml
 * hosted_pricing_state; Terms section 6: "no new subscriptions can be
 * created"). Before 2026-08-29 this helper still held a create branch, so a
 * legacy plan='pro' row with a Stripe customer, no subscription, and one
 * active node would mint a brand-new billable subscription from a plain
 * server enrollment, contradicting the retired /billing/checkout route (410).
 * Managing an EXISTING subscription stays: a residual paying customer must be
 * able to have their quantity tracked and their subscription cancelled.
 * Removing creation also removes the double-create concurrency hazard this
 * function had (no DB lock, no Stripe idempotency key): the remaining
 * branches are idempotent by value (cancel of a cancelled sub throws and is
 * logged; update to the same quantity is a no-op).
 */
export async function syncSubscriptionQuantity(customerId: string): Promise<SyncResult> {
  if (!stripe) {
    return { action: "skipped", billable: 0, subscriptionId: null, reason: "stripe not configured" };
  }

  const customerResult = await query(
    `SELECT plan, stripe_customer_id, stripe_subscription_id FROM customers WHERE id = $1`,
    [customerId]
  );
  if (customerResult.rows.length === 0) {
    return { action: "skipped", billable: 0, subscriptionId: null, reason: "customer not found" };
  }

  const c = customerResult.rows[0];
  if (c.plan !== "pro") {
    return { action: "none", billable: 0, subscriptionId: c.stripe_subscription_id };
  }
  if (!c.stripe_customer_id) {
    return { action: "skipped", billable: 0, subscriptionId: null, reason: "no stripe customer id" };
  }

  const countResult = await query(
    `SELECT COUNT(*)::int AS n FROM servers WHERE customer_id = $1 AND status = 'active'`,
    [customerId]
  );
  const nodeCount: number = countResult.rows[0].n;
  const billable = Math.max(0, nodeCount);

  // billable === 0, no sub: nothing to do
  if (billable === 0 && !c.stripe_subscription_id) {
    return { action: "none", billable, subscriptionId: null };
  }

  // billable === 0, sub exists: cancel with proration credit
  if (billable === 0 && c.stripe_subscription_id) {
    await stripe.subscriptions.cancel(c.stripe_subscription_id, { prorate: true });
    await query(`UPDATE customers SET stripe_subscription_id = NULL WHERE id = $1`, [customerId]);
    return { action: "cancelled", billable, subscriptionId: null };
  }

  // billable > 0, no sub: REFUSED. There is no paid tier to subscribe to
  // (checkout answers 410); a customer with no live subscription can never
  // gain one through node-count sync.
  if (billable > 0 && !c.stripe_subscription_id) {
    return { action: "skipped", billable, subscriptionId: null, reason: "subscription creation retired (no paid tier)" };
  }

  // billable > 0, sub exists: update quantity (if changed)
  const sub = await stripe.subscriptions.retrieve(c.stripe_subscription_id);
  const item = sub.items.data[0];
  if (!item) {
    return { action: "skipped", billable, subscriptionId: c.stripe_subscription_id, reason: "sub has no items" };
  }
  if (item.quantity === billable) {
    return { action: "none", billable, subscriptionId: c.stripe_subscription_id };
  }
  await stripe.subscriptions.update(c.stripe_subscription_id, {
    items: [{ id: item.id, quantity: billable }],
    proration_behavior: "create_prorations",
  });
  return { action: "updated", billable, subscriptionId: c.stripe_subscription_id };
}

/**
 * Fire-and-forget wrapper for use in request handlers. Logs failures but never
 * throws, so a Stripe hiccup cannot fail a server add/delete operation. The
 * helper is idempotent so a subsequent call (e.g. on the next node change) will
 * correct any drift.
 */
export async function syncSubscriptionQuantitySafe(customerId: string): Promise<void> {
  try {
    const result = await syncSubscriptionQuantity(customerId);
    if (result.action !== "none") {
      console.log(`[billing:sync] customer=${customerId} action=${result.action} billable=${result.billable} sub=${result.subscriptionId ?? "none"}${result.reason ? " reason=" + result.reason : ""}`);
    }
  } catch (err: any) {
    console.error(`[billing:sync] customer=${customerId} failed:`, err?.message ?? err);
  }
}
