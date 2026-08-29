import Stripe from "stripe";
import { HOSTED_FREE_NODE_CAP } from "../self-hosted";

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = secretKey ? new Stripe(secretKey) : null;

export function isStripeConfigured(): boolean {
  return !!stripe;
}

export const PRICES: Record<string, string> = {
  pro: process.env.STRIPE_PRO_PRICE_ID || "",
};

// `free` is the CURRENT hosted contract: the node cap from self-hosted.ts
// (migration 040 moved production to it) and the 90-day telemetry window the
// ClickHouse TTL enforces for everyone. It used to say 3 nodes / 7 days, which
// predates the pivot, so a legacy Pro subscriber who cancelled was downgraded
// onto a plan that no longer exists: servers beyond THREE suspended and a
// 7-day retention figure written into their row, on a product whose public
// contract is 10 and 90.
export const PLAN_LIMITS: Record<string, { server_limit: number; retention_days: number; managed_alerts: boolean }> = {
  free:       { server_limit: HOSTED_FREE_NODE_CAP, retention_days: 90, managed_alerts: false },
  pro:        { server_limit: 9999, retention_days: 90,  managed_alerts: true },
  enterprise: { server_limit: 9999, retention_days: 730, managed_alerts: true },
};

// Per-node pricing.
// Pro plan: $3/server/month, first 3 servers free, no flat fee.
// Free plan is capped at 3 servers (via PLAN_LIMITS).
export const PRICE_PER_NODE_USD = 3;

// Pro tier free quota: the first FREE_NODES_PRO servers don't add to the
// monthly bill. Server #4 onwards is charged at PRICE_PER_NODE_USD.
export const FREE_NODES_PRO = 3;

/**
 * Pro billable node count: the slice of the customer's active server
 * count that is actually charged. Defined as `max(0, count - 3)`.
 *
 * Display path uses this to render the "(M chargeable, 3 free)" copy
 * on the Settings page. Note the Stripe sync path
 * (lib/server/billing/sync.ts) currently bills against the raw
 * `nodeCount` and does NOT subtract the free quota; that is a known
 * pre-launch billing-side bug surfaced separately.
 */
export function billableNodes(nodeCount: number): number {
  return Math.max(0, nodeCount - FREE_NODES_PRO);
}

/**
 * Compute the monthly cost in USD.
 *
 * Free plan: always $0 (capped at 3 servers by PLAN_LIMITS.free.server_limit).
 * Pro plan: $3 per chargeable node, where the first 3 are free.
 * Enterprise: custom (caller should not use this helper for enterprise billing).
 */
export function computeMonthlyCost(plan: string, nodeCount: number): number {
  if (plan !== "pro") return 0;
  return billableNodes(nodeCount) * PRICE_PER_NODE_USD;
}

export type PlanId = keyof typeof PLAN_LIMITS;
