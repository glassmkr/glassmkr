// Operator-targeted Telegram pings for Stripe webhook events. Distinct from
// customer-facing alert dispatcher (apps/dashboard/src/lib/server/alerts/
// dispatcher.ts) which sends to per-customer alert channels. These pings
// always go to the single chat in OPERATOR_TELEGRAM_CHAT_ID regardless of
// which customer triggered the event.
//
// Spec: CC_STRIPE_WEBHOOK.md. Failure to deliver must NOT abort webhook
// processing; we 200 to Stripe even if Telegram is down, log the failure,
// and move on.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// TODO(fast-follow): move to an operator-scoped settings table once that concept exists.
// Hardcoded env var works as long as Glassmkr has a single operator;
// for any multi-operator scenario (DataPacket-internal handoff, hires)
// this needs to live in a database row keyed by operator identity.
const OPERATOR_CHAT_ID = process.env.OPERATOR_TELEGRAM_CHAT_ID || "";

export async function notifyOperator(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !OPERATOR_CHAT_ID) {
    console.warn(
      "[operator-notify] TELEGRAM_BOT_TOKEN or OPERATOR_TELEGRAM_CHAT_ID not set; skipping",
    );
    return;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: OPERATOR_CHAT_ID,
          text,
          // Plain text only. No HTML/Markdown parse mode so we don't have
          // to escape email addresses or sub IDs.
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      console.warn(`[operator-notify] Telegram ${res.status}: ${await res.text()}`);
    }
  } catch (err: any) {
    console.warn(`[operator-notify] send failed: ${err?.message}`);
  }
}

function fmtAmount(cents: number | null | undefined, currency = "usd"): string {
  if (cents == null) return "(unknown amount)";
  const n = cents / 100;
  const symbol = currency.toLowerCase() === "usd" ? "$" : currency.toUpperCase() + " ";
  return `${symbol}${n.toFixed(2)}`;
}

// Specific message builders. Keeping templates here so the webhook handler
// stays focused on Stripe API shape.

export interface SignupCtx {
  email: string;
  plan: string;
  amountCents: number | null;
  quantity: number;
  subscriptionId: string;
  glassmkrCustomerId: string | null;
}
export function notifySignup(c: SignupCtx): Promise<void> {
  const linked = c.glassmkrCustomerId
    ? `linked (${c.glassmkrCustomerId})`
    : "NOT FOUND - investigate";
  const text = [
    "NEW PRO SIGNUP",
    "",
    `Email: ${c.email}`,
    `Plan: ${c.plan}`,
    `Amount: ${fmtAmount(c.amountCents)}/month`,
    `Quantity: ${c.quantity} nodes`,
    `Subscription: ${c.subscriptionId}`,
    "",
    `Glassmkr account: ${linked}`,
  ].join("\n");
  return notifyOperator(text);
}

export interface ChangeCtx {
  email: string;
  oldQuantity: number;
  newQuantity: number;
  oldAmountCents: number | null;
  newAmountCents: number | null;
  subscriptionId: string;
}
export function notifySubscriptionChanged(c: ChangeCtx): Promise<void> {
  const text = [
    "SUBSCRIPTION CHANGED",
    "",
    `Email: ${c.email}`,
    `Old: ${c.oldQuantity} nodes at ${fmtAmount(c.oldAmountCents)}/month`,
    `New: ${c.newQuantity} nodes at ${fmtAmount(c.newAmountCents)}/month`,
    `Subscription: ${c.subscriptionId}`,
  ].join("\n");
  return notifyOperator(text);
}

export interface CancellationCtx {
  email: string;
  quantity: number;
  amountCents: number | null;
  cancelledAt: string;
  subscriptionId: string;
}
export function notifyCancellation(c: CancellationCtx): Promise<void> {
  const text = [
    "SUBSCRIPTION CANCELLED",
    "",
    `Email: ${c.email}`,
    `Was: ${c.quantity} nodes at ${fmtAmount(c.amountCents)}/month`,
    `Cancelled at: ${c.cancelledAt}`,
    `Subscription: ${c.subscriptionId}`,
  ].join("\n");
  return notifyOperator(text);
}

export interface PaymentFailedCtx {
  email: string;
  subscriptionId: string;
  amountCents: number | null;
  attemptCount: number;
  nextRetryAt: string | null;
}
export function notifyPaymentFailed(c: PaymentFailedCtx): Promise<void> {
  const text = [
    "PAYMENT FAILED (URGENT)",
    "",
    `Email: ${c.email}`,
    `Subscription: ${c.subscriptionId}`,
    `Amount: ${fmtAmount(c.amountCents)}`,
    `Attempt count: ${c.attemptCount}`,
    `Next retry: ${c.nextRetryAt ?? "none scheduled"}`,
    "",
    "Stripe will retry automatically. Subscription marked as past_due.",
  ].join("\n");
  return notifyOperator(text);
}

export interface CancelScheduledCtx {
  email: string;
  endsAt: string;
  subscriptionId: string;
}
// Fired when a customer hits "Cancel subscription" inside Dashboard: Stripe
// sends customer.subscription.updated with cancel_at_period_end=true. We
// distinguish this from a generic update in the handler.
export function notifyCancelScheduled(c: CancelScheduledCtx): Promise<void> {
  const text = [
    "Subscription cancellation",
    "",
    `Email: ${c.email}`,
    `Ends: ${c.endsAt}`,
    `Subscription: ${c.subscriptionId}`,
  ].join("\n");
  return notifyOperator(text);
}
