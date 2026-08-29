// scope: admin
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { stripe, isStripeConfigured } from "$lib/server/billing/stripe";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

// POST /api/v1/billing/portal - open a Stripe Billing Portal session.
//
// Works for any customer who has a Stripe customer record, with or without an
// active subscription. Pro customers with <=0 billable nodes under the lazy-
// sub model still benefit from the portal for updating their payment method
// and viewing past invoices.
export const POST: RequestHandler = async (event) => {
  // Session-only by design (Stripe portal is UI-redirect; no acct_key path).
  const principal = await requireAuth(event, { allow: ["session"] });
  requireScopeLevel(principal, "admin");

  if (!stripe || !isStripeConfigured()) {
    return json({ error: "Billing is not yet available" }, { status: 503 });
  }

  try {
    const result = await query(
      `SELECT email, stripe_customer_id FROM customers WHERE id = $1`,
      [principal.customer_id]
    );
    const c = result.rows[0];
    if (!c) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    // Ensure the customer has a Stripe customer record. This covers edge cases
    // where plan was set manually (admin seed, DB migration) without going
    // through checkout first.
    let stripeCustomerId: string = c.stripe_customer_id;
    if (!stripeCustomerId) {
      const sc = await stripe.customers.create({
        email: c.email,
        metadata: { glassmkr_customer_id: principal.customer_id },
      });
      stripeCustomerId = sc.id;
      await query(
        `UPDATE customers SET stripe_customer_id = $1 WHERE id = $2`,
        [stripeCustomerId, principal.customer_id]
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `https://app.glassmkr.com/#settings`,
    });
    return json({ url: session.url });
  } catch (err: any) {
    // Surface Stripe errors so the operator can see the real cause (most
    // commonly: no Billing Portal configuration in the Stripe dashboard).
    const stripeMessage = err?.raw?.message || err?.message || "Failed to open billing portal";
    const stripeCode = err?.raw?.code || err?.code;
    console.error(
      `[billing:portal] customer=${principal.customer_id} error=${stripeCode ?? "unknown"} msg=${stripeMessage}`
    );
    return json(
      {
        error: stripeMessage,
        code: stripeCode,
        hint: stripeCode === "billing_portal_configuration_not_found"
          ? "Configure the Stripe Billing Portal at https://dashboard.stripe.com/settings/billing/portal"
          : undefined,
      },
      { status: 500 }
    );
  }
};
