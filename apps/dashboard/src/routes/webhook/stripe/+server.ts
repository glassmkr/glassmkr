import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { stripe, isStripeConfigured, PRICES, PLAN_LIMITS } from "$lib/server/billing/stripe";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";
import { sendPaymentFailedEmail, sendCardRemovedEmail } from "$lib/server/billing/email";
import { suspendExcessServers } from "$lib/server/billing/suspension";
import { isBillingEnforcementEnabled } from "$lib/server/billing/enforcement-flag";
import {
  notifySignup,
  notifySubscriptionChanged,
  notifyCancellation,
  notifyCancelScheduled,
  notifyPaymentFailed,
} from "$lib/server/billing/operator-notify";
import { enforceIpRateLimit, rateLimitedResponse } from "$lib/server/auth/rate-limit-middleware";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

async function applyPlan(customerId: string, plan: string, subscriptionId: string | null): Promise<void> {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  await query(
    `UPDATE customers SET plan = $1, stripe_subscription_id = $2, plan_server_limit = $3,
     plan_retention_days = $4, plan_managed_alerts = $5, plan_updated_at = NOW() WHERE id = $6`,
    [plan, subscriptionId, limits.server_limit, limits.retention_days, limits.managed_alerts, customerId]
  );
}

function planFromPriceId(priceId: string): string {
  if (priceId === PRICES.pro) return "pro";
  if (priceId === PRICES.business) return "business";
  return "free";
}

// Mirror a Stripe subscription object into our stripe_subscriptions audit
// table. Idempotent: re-running with the same data is a no-op aside from
// updated_at/status changes.
async function upsertSubscriptionRow(sub: any): Promise<void> {
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!stripeCustomerId) return;
  // Resolve our customer id (nullable; webhook may arrive before checkout
  // is fully wired up to a Glassmkr customer row).
  const cRes = await query(
    `SELECT id FROM customers WHERE stripe_customer_id = $1`,
    [stripeCustomerId],
  );
  const glassmkrCustomerId = cRes.rows[0]?.id ?? null;
  const item = sub.items?.data?.[0];
  const quantity = (typeof item?.quantity === "number" ? item.quantity : sub.quantity) ?? 0;
  const planId = item?.price?.id ?? "";
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  const created = sub.created ? new Date(sub.created * 1000) : new Date();
  const cancelledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;

  await query(
    `INSERT INTO stripe_subscriptions
       (id, customer_id, glassmkr_customer_id, status, plan_id, quantity,
        current_period_end, cancel_at_period_end, cancelled_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id,
       glassmkr_customer_id = COALESCE(stripe_subscriptions.glassmkr_customer_id, EXCLUDED.glassmkr_customer_id),
       status = EXCLUDED.status,
       plan_id = EXCLUDED.plan_id,
       quantity = EXCLUDED.quantity,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       cancelled_at = EXCLUDED.cancelled_at,
       updated_at = NOW()`,
    [
      sub.id, stripeCustomerId, glassmkrCustomerId, sub.status ?? "unknown",
      planId, quantity, periodEnd, !!sub.cancel_at_period_end, cancelledAt, created,
    ],
  );
}

// Resolve a customer's email + amount (from price.unit_amount * quantity) for
// operator-facing message templates. Tolerant of partial Stripe payloads.
async function resolveCustomerEmail(stripeCustomerId: string | undefined): Promise<string> {
  if (!stripeCustomerId) return "(unknown)";
  const r = await query(
    `SELECT email FROM customers WHERE stripe_customer_id = $1`,
    [stripeCustomerId],
  );
  if (r.rows[0]?.email) return r.rows[0].email;
  if (stripe) {
    try {
      const cust = await stripe.customers.retrieve(stripeCustomerId);
      if (cust && !cust.deleted && cust.email) return cust.email;
    } catch { /* best-effort */ }
  }
  return "(unknown)";
}

function subAmountCents(sub: any): number | null {
  const item = sub.items?.data?.[0];
  const unit = item?.price?.unit_amount;
  const qty = item?.quantity ?? sub.quantity ?? 1;
  if (typeof unit !== "number") return null;
  return unit * qty;
}

// POST /webhook/stripe - Stripe webhook (raw body for signature verification)
export const POST: RequestHandler = async (event) => {
  // Per-IP rate limit (audit §1.5 item 6, catalog 3.5). Runs before
  // signature verification so a forged-request flood from one source
  // can't burn CPU on constructEvent or hammer the idempotency table.
  // Legitimate Stripe webhooks arrive from a small set of Stripe-owned
  // IPs, so the bucket is sized generously: 120 burst, 4/s sustained
  // (240/min) comfortably covers event bursts + delivery retries.
  const limited = await enforceIpRateLimit(event, {
    namespaceSuffix: "stripe-webhook",
    capacity: 120,
    refillPerSecond: 4,
  });
  if (limited) {
    console.warn(`[billing] Stripe webhook rate-limited; retry_after=${limited.failure.retryAfterSeconds}s`);
    return rateLimitedResponse(limited.failure);
  }

  if (!stripe || !isStripeConfigured() || !WEBHOOK_SECRET) {
    return json({ error: "Webhooks not configured" }, { status: 503 });
  }

  const sig = event.request.headers.get("stripe-signature");
  if (!sig) {
    return json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Use raw text body for Stripe signature verification
  const rawBody = await event.request.text();

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency claim. INSERT first with ON CONFLICT DO NOTHING; the
  // RETURNING is empty if another caller already claimed this event_id.
  // Codex review 2026-05-05 flagged the previous read-then-write
  // pattern as concurrency-unsafe: two simultaneous deliveries of the
  // same event could both pass the SELECT check. The atomic INSERT
  // closes that race. On processing failure below we DELETE the claim
  // so Stripe's retry can re-run the handler.
  const claim = await query(
    `INSERT INTO stripe_events_processed (event_id, event_type, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [stripeEvent.id, stripeEvent.type, JSON.stringify(stripeEvent)],
  );
  if (claim.rows.length === 0) {
    console.log(`[billing] Duplicate webhook event ${stripeEvent.id} (${stripeEvent.type}); skipping`);
    return json({ received: true, duplicate: true });
  }

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object as any;
        const customerId = session.metadata?.glassmkr_customer_id;
        const plan = session.metadata?.plan || "pro";

        // Operator ping fires whether or not we manage to link the
        // session to a Glassmkr account. If linking fails, the message
        // says NOT FOUND - investigate, which is the situation Simon
        // actually wants to know about.
        let amountCents: number | null = null;
        let quantity = 0;
        let subId = "";
        if (session.subscription && stripe) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            amountCents = subAmountCents(sub);
            quantity = sub.items?.data?.[0]?.quantity ?? 0;
            subId = sub.id;
            await upsertSubscriptionRow(sub);
          } catch { /* best-effort */ }
        }
        const email = session.customer_email
          ?? session.customer_details?.email
          ?? await resolveCustomerEmail(session.customer);
        await notifySignup({
          email, plan, amountCents, quantity, subscriptionId: subId,
          glassmkrCustomerId: customerId ?? null,
        });

        if (!customerId) break;

        if (session.mode === "setup") {
          // Customer upgraded to Pro but is at or below the free-tier threshold.
          // Attach the collected payment method as default so we can charge them
          // later when they add a 4th node, then mark them as Pro. No subscription
          // yet; syncSubscriptionQuantity is a no-op until billable > 0.
          if (session.setup_intent) {
            const si = await stripe!.setupIntents.retrieve(session.setup_intent as string);
            if (si.payment_method && session.customer) {
              await stripe!.customers.update(session.customer as string, {
                invoice_settings: { default_payment_method: si.payment_method as string },
              });
            }
          }
          await applyPlan(customerId, plan, null);
          await syncSubscriptionQuantitySafe(customerId);
          console.log(`[billing] Customer ${customerId} upgraded to ${plan} (setup mode, no sub yet)`);
        } else if (session.subscription) {
          await applyPlan(customerId, plan, session.subscription);
          // Reconcile in case node count changed between checkout start and completion.
          await syncSubscriptionQuantitySafe(customerId);
          console.log(`[billing] Customer ${customerId} upgraded to ${plan} (sub ${session.subscription})`);
        }
        break;
      }

      case "customer.subscription.created": {
        // Stripe sends this in addition to checkout.session.completed.
        // Mirror it into stripe_subscriptions; skip the operator ping
        // because checkout.session.completed already covered it. If
        // checkout was bypassed (rare; Stripe Dashboard manual sub
        // creation), still emit a ping so the operator notices.
        const sub = stripeEvent.data.object as any;
        await upsertSubscriptionRow(sub);
        // Heuristic: if the matching checkout fired in the last 5
        // minutes for this customer, we already pinged. Otherwise ping.
        const recent = await query(
          `SELECT 1 FROM stripe_events_processed
           WHERE event_type = 'checkout.session.completed'
             AND processed_at > NOW() - INTERVAL '5 minutes'
             AND payload->'data'->'object'->>'customer' = $1`,
          [typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? ""],
        );
        if (recent.rows.length === 0) {
          await notifySignup({
            email: await resolveCustomerEmail(sub.customer),
            plan: "pro",
            amountCents: subAmountCents(sub),
            quantity: sub.items?.data?.[0]?.quantity ?? 0,
            subscriptionId: sub.id,
            glassmkrCustomerId: null,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = stripeEvent.data.object as any;
        const previous = (stripeEvent.data as any).previous_attributes ?? {};
        const stripeCustomerId = sub.customer;
        const result = await query(`SELECT id FROM customers WHERE stripe_customer_id = $1`, [stripeCustomerId]);
        const customerId = result.rows[0]?.id;

        await upsertSubscriptionRow(sub);

        if (customerId && sub.status === "active") {
          const priceId = sub.items?.data?.[0]?.price?.id || "";
          const plan = planFromPriceId(priceId);
          await applyPlan(customerId, plan, sub.id);
          console.log(`[billing] Customer ${customerId} subscription updated to ${plan}`);
        } else if (customerId && (sub.status === "past_due" || sub.status === "unpaid")) {
          console.warn(`[billing] Customer ${customerId} subscription ${sub.status}`);
        }

        // Distinct operator-ping cases:
        //  (1) cancel_at_period_end newly TRUE: customer scheduled
        //      cancellation through the in-app Cancel button. Use the
        //      "Subscription cancellation" template.
        //  (2) quantity or plan_id changed: use the SUBSCRIPTION CHANGED
        //      template.
        //  (3) anything else (status flips, metadata changes): no ping.
        const cancelFlippedOn =
          !!sub.cancel_at_period_end && previous.cancel_at_period_end === false;
        const cancelFlippedOff =
          sub.cancel_at_period_end === false && previous.cancel_at_period_end === true;

        if (cancelFlippedOn) {
          const endsAt = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString().slice(0, 19) + " UTC"
            : "(unknown)";
          await notifyCancelScheduled({
            email: await resolveCustomerEmail(stripeCustomerId),
            endsAt,
            subscriptionId: sub.id,
          });
        } else if (cancelFlippedOff) {
          // Resume; not in spec but useful operator signal.
          console.log(`[billing] Customer ${customerId ?? "?"} resumed subscription ${sub.id}`);
        } else {
          const oldQty: number | undefined = previous.items?.data?.[0]?.quantity ?? previous.quantity;
          const newQty: number | undefined = sub.items?.data?.[0]?.quantity ?? sub.quantity;
          const oldPriceId: string | undefined = previous.items?.data?.[0]?.price?.id;
          const newPriceId: string | undefined = sub.items?.data?.[0]?.price?.id;
          const qtyChanged = typeof oldQty === "number" && oldQty !== newQty;
          const planChanged = typeof oldPriceId === "string" && oldPriceId !== newPriceId;
          if (qtyChanged || planChanged) {
            await notifySubscriptionChanged({
              email: await resolveCustomerEmail(stripeCustomerId),
              oldQuantity: oldQty ?? 0,
              newQuantity: newQty ?? 0,
              oldAmountCents: typeof oldQty === "number" && typeof previous.items?.data?.[0]?.price?.unit_amount === "number"
                ? previous.items.data[0].price.unit_amount * oldQty
                : null,
              newAmountCents: subAmountCents(sub),
              subscriptionId: sub.id,
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object as any;
        const stripeCustomerId = sub.customer;
        const result = await query(`SELECT id FROM customers WHERE stripe_customer_id = $1`, [stripeCustomerId]);
        const customerId = result.rows[0]?.id;

        await upsertSubscriptionRow(sub);

        // Distinguish between:
        //  (a) sync.ts auto-cancelled because billable dropped to 0 (customer still Pro)
        //  (b) customer cancelled via in-app cancel or billing portal (actual downgrade to Free)
        // The lazy=true metadata flag is only set on subs created by sync.ts.
        const isLazy = sub.metadata?.lazy === "true";

        if (isLazy) {
          if (customerId) {
            await query(`UPDATE customers SET stripe_subscription_id = NULL WHERE id = $1`, [customerId]);
          }
          console.log(`[billing] Sub ${sub.id} auto-cancelled (billable=0); customer ${customerId ?? "?"} stays on Pro`);
          break;
        }

        if (customerId) {
          await applyPlan(customerId, "free", null);

          // Delegate suspension to the shared helper. Both this path
          // (full cancellation) and the enforcement cron path (no card
          // on file at billing-period-end) call the same helper, so
          // the "oldest 3 stay" ordering is enforced at one source.
          // Previously this used `last_seen_at DESC` here, which gave
          // operationally-different "kept" servers depending on recent
          // push timing — regression-locked in
          // billing/__tests__/suspension.test.ts.
          const result = await suspendExcessServers(
            customerId,
            PLAN_LIMITS.free.server_limit,
            "subscription_cancelled",
          );
          if (result.suspended_ids.length > 0) {
            console.log(`[billing] Suspended ${result.suspended_ids.length} excess servers for customer ${customerId} reason=subscription_cancelled`);
          }
          console.log(`[billing] Customer ${customerId} downgraded to free`);
        }

        await notifyCancellation({
          email: await resolveCustomerEmail(stripeCustomerId),
          quantity: sub.items?.data?.[0]?.quantity ?? sub.quantity ?? 0,
          amountCents: subAmountCents(sub),
          cancelledAt: new Date().toISOString().slice(0, 19) + " UTC",
          subscriptionId: sub.id,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = stripeEvent.data.object as any;
        const stripeCustomerId = invoice.customer;
        console.warn(`[billing] Payment failed for Stripe customer ${stripeCustomerId}`);

        const pfResult = await query(`SELECT id, email FROM customers WHERE stripe_customer_id = $1`, [stripeCustomerId]);
        if (pfResult.rows.length > 0) {
          const c = pfResult.rows[0];
          const sent = await sendPaymentFailedEmail(c.email);
          console.log(`[billing] Payment-failed email to ${c.email}: ${sent ? "sent" : "failed"}`);
        }

        const nextRetry = invoice.next_payment_attempt
          ? new Date(invoice.next_payment_attempt * 1000).toISOString().slice(0, 19) + " UTC"
          : null;
        await notifyPaymentFailed({
          email: await resolveCustomerEmail(stripeCustomerId),
          subscriptionId: invoice.subscription ?? "(none)",
          amountCents: typeof invoice.amount_due === "number" ? invoice.amount_due : null,
          attemptCount: invoice.attempt_count ?? 0,
          nextRetryAt: nextRetry,
        });
        break;
      }

      case "invoice.payment_succeeded": {
        // Audit-only; Stripe handles the customer-facing receipt email.
        console.log(`[billing] invoice.payment_succeeded ${(stripeEvent.data.object as any).id}`);
        break;
      }

      case "payment_method.detached": {
        // The customer removed their default payment method. Don't disable
        // anything yet — disable happens at the end of the current billing
        // period, surfaced by the hourly billing-enforcement cron. This
        // handler logs the audit line always; the email send is gated on
        // BILLING_ENFORCEMENT_ENABLED so flag-off deploys don't surprise
        // any customer with a "card removed" email before the enforcement
        // workstream is live.
        const pm = stripeEvent.data.object as any;
        const stripeCustomerId = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
        console.log(
          `[billing-enforcement] payment_method.detached pm=${pm.id} stripe_customer=${stripeCustomerId ?? "unknown"} type=${pm.type ?? "unknown"}`
        );

        if (!isBillingEnforcementEnabled() || !stripeCustomerId) break;

        // Look up our customer + active server count + their next
        // current_period_end. Filter to the cohort the enforcement
        // workstream actually affects: Pro plan, not exempt, more than
        // the free quota of active servers. Otherwise Free / exempt /
        // under-quota customers get a card-removed email warning of a
        // suspension that will never happen. Codex 2026-05-12 P2.
        const cRes = await query(
          `SELECT c.id::text AS customer_id, c.email, c.display_name,
                  COALESCE(latest_sub.current_period_end,
                           c.created_at + INTERVAL '30 days') AS grace_period_end,
                  (SELECT COUNT(*) FROM servers s
                    WHERE s.customer_id = c.id AND s.status = 'active') AS active_count
             FROM customers c
             LEFT JOIN (
               SELECT DISTINCT ON (glassmkr_customer_id)
                      glassmkr_customer_id,
                      current_period_end
                 FROM stripe_subscriptions
                ORDER BY glassmkr_customer_id, updated_at DESC
             ) latest_sub ON latest_sub.glassmkr_customer_id = c.id
            WHERE c.stripe_customer_id = $1
              AND c.plan = 'pro'
              AND NOT COALESCE(c.billing_enforcement_exempt, false)`,
          [stripeCustomerId],
        );
        if (cRes.rows.length === 0) break;
        const c = cRes.rows[0] as { customer_id: string; email: string | null; display_name: string | null; grace_period_end: Date; active_count: string | number };
        if (!c.email) break;
        const activeCount = Number(c.active_count) || 0;
        // FREE_QUOTA constant (3) matches email-reminders.ts and the
        // enforcement scheduler. A customer at or under quota wouldn't
        // be suspended even if their card stays detached, so the
        // warning email is misleading.
        if (activeCount <= 3) {
          console.log(`[billing-enforcement] card-removed-email skipped customer=${c.customer_id} reason=under_quota active=${activeCount}`);
          break;
        }
        const fname = (c.display_name && c.display_name.trim().split(/\s+/)[0]) || c.email.split("@")[0] || "there";
        const grace = c.grace_period_end ? c.grace_period_end.toISOString().slice(0, 10) + " " + c.grace_period_end.toISOString().slice(11, 16) + " UTC" : "(unknown)";
        const ok = await sendCardRemovedEmail({
          to: c.email,
          firstName: fname,
          activeServerCount: activeCount,
          currentPeriodEndUtc: grace,
        });
        console.log(`[billing-enforcement] card-removed-email customer=${c.customer_id} ok=${ok}`);
        break;
      }

      case "payment_method.attached": {
        // Customer added a (or replaced their) payment method. Per
        // discovery, we don't store any persistent recovery flag —
        // /api/v1/billing/status reads live Stripe state per request,
        // so the UI's "Restore" button enabled-state is always fresh.
        // Audit-log only.
        const pm = stripeEvent.data.object as any;
        const stripeCustomerId = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
        console.log(
          `[billing-enforcement] payment_method.attached pm=${pm.id} stripe_customer=${stripeCustomerId ?? "unknown"} type=${pm.type ?? "unknown"}`
        );
        break;
      }

      default:
        // Unknown event type. Logged at info, no further processing,
        // not an error. New handlers can be added incrementally.
        console.log(`[billing] Unhandled webhook event ${stripeEvent.type}`);
    }

    // Claim row was already inserted at the start of the request;
    // on success we leave it in place as the audit record.
  } catch (err: any) {
    console.error(`[billing] Webhook handler error for ${stripeEvent.type}:`, err);
    // Release the claim so Stripe's retry can re-run the handler.
    // Without this, the failed event would appear processed and
    // retries would skip as duplicates.
    try {
      await query(
        `DELETE FROM stripe_events_processed WHERE event_id = $1`,
        [stripeEvent.id],
      );
    } catch (delErr: any) {
      console.error(`[billing] Failed to release claim for ${stripeEvent.id}:`, delErr?.message);
    }
    return json({ error: "Internal error" }, { status: 500 });
  }

  return json({ received: true });
};
