// scope: write
// POST /api/v1/servers/{id}/restore
//
// Re-activate a server that was previously suspended by the billing-
// enforcement workstream. Behaviour:
//
//   - Customer must own the server (auth + ownership check).
//   - Stripe must show a default payment method on the customer's
//     subscription RIGHT NOW. We don't trust local state — a card
//     could have been removed between the dashboard render and this
//     request. The live Stripe call is the source of truth.
//   - On success: clear `suspended_at` + `suspended_reason`, set
//     `status='active'`. Snapshot ingest was never gated, so there's
//     no data continuity gap.
//
// While `BILLING_ENFORCEMENT_ENABLED` is off (default for PR A), this
// endpoint returns 503 with a clear message — the restore action only
// makes sense when enforcement is also live. See the discovery doc:
// `apps/dashboard/docs/billing-enforcement-discovery.md`.

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
import { requireServerOwnership } from "$lib/server/authz";
import { restoreDeletedServerForCustomer } from "$lib/server/services/server-admin-actions";
import { stripe, isStripeConfigured } from "$lib/server/billing/stripe";
import { isBillingEnforcementEnabled } from "$lib/server/billing/enforcement-flag";
import type { Principal } from "$lib/server/auth/principal";

export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "restore",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
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
      action: "restore",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
      resource_id: event.params.id,
    });
    throw err;
  }

  // Pro-tier gate for programmatic callers (acct_key).
  // Sessions bypass: a Free customer with a suspended server must
  // still be able to click Restore in the dashboard after fixing
  // their payment method. Closes the leak surfaced by the free-tier
  // audit on 2026-05-13.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "restore",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: restore is `write` (it materially
  // changes server state).
  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "restore",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const serverId = event.params.id ?? "";
  try {
    await requireServerOwnership(serverId, principal.customer_id, "id");
  } catch (err) {
    throw err;
  }

  // Pull the server's current state. If it isn't suspended, restore is a
  // no-op — return 200 idempotently rather than 400, so a double-click
  // from the dashboard doesn't surface as an error.
  // BOLA defence: customer_id constraint duplicates the ownership check
  // requireServerOwnership() already enforced; cheap belt-and-suspenders.
  const serverRes = await query(
    `SELECT id, name, status, suspended_at, suspended_reason
       FROM servers WHERE id = $1 AND customer_id = $2`,
    [serverId, principal.customer_id],
  );
  if (serverRes.rows.length === 0) {
    return json({ error: "server_not_found" }, { status: 404 });
  }
  const server = serverRes.rows[0] as {
    id: string;
    name: string;
    status: string;
    suspended_at: Date | null;
    suspended_reason: string | null;
  };
  if (server.status === "active") {
    return json({ success: true, server: { id: server.id, name: server.name, status: "active" }, already_active: true });
  }

  // Soft-deleted servers (e.g. an MCP delete_server, which is a soft delete) are
  // un-deleted directly, quota-checked. A soft delete is NOT a billing suspension,
  // so this runs BEFORE the billing-enforcement short-circuit below and does not
  // apply the no_card_on_file card checks (Codex 2026-07-21 #6).
  if (server.status === "deleted") {
    const restored = await restoreDeletedServerForCustomer(principal.customer_id, serverId);
    if (restored.status === "quota_exceeded") {
      void writeAudit({
        event, principal, action: "restore",
        result: "forbidden", status_code: 403,
        resource_type: "server", resource_id: serverId,
        metadata: { restored_from: "deleted", reason: "quota", limit: restored.limit },
      });
      return json(
          { error: "quota_exceeded", message: `This account is at its ${restored.limit}-node cap; the server was not restored. Remove a server first, or self-host Glassmkr, which has no node limit: https://glassmkr.com/docs/self-hosting` },
        { status: 403 },
      );
    }
    if (restored.status === "not_found") {
      void writeAudit({
        event, principal, action: "restore",
        result: "not_found", status_code: 404,
        resource_type: "server", resource_id: serverId,
        metadata: { restored_from: "deleted" },
      });
      return json({ error: "server_not_found" }, { status: 404 });
    }
    void writeAudit({
      event, principal, action: "restore",
      result: "success", status_code: 200,
      resource_type: "server", resource_id: serverId,
      metadata: { restored_from: "deleted" },
    });
    return json({ success: true, server: { id: restored.id, name: restored.name, status: "active" }, restored_from: "deleted" });
  }

  // Flag-off short-circuit for the BILLING (suspended) restore path only. The 503
  // keeps the endpoint discoverable but rejects billing-restore callers cleanly
  // until enforcement is live. Soft-delete restore above is independent of it.
  if (!isBillingEnforcementEnabled()) {
    void writeAudit({
      event,
      principal,
      action: "restore",
      result: "error",
      status_code: 503,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "feature_flag_off" },
    });
    return json(
      { error: "Billing enforcement not yet active. Server restoration is not available." },
      { status: 503 },
    );
  }

  // This endpoint restores no-card-on-file suspensions only. Other
  // suspension reasons (subscription_cancelled, abuse, ...) require
  // different remediation paths (resubscribe via the Stripe portal,
  // operator review, etc.) and must not be cleared by adding a card.
  // restore-all enforces the same predicate at the SQL UPDATE; this
  // single-server route did not, which let a customer whose
  // subscription had been cancelled but who still had a card on file
  // reactivate without resubscribing. Codex 2026-05-12 P1.
  if (server.suspended_reason !== "no_card_on_file") {
    return json(
      {
        error: "wrong_suspension_reason",
        message:
          "This server cannot be restored by adding a payment method. " +
          "Contact support@glassmkr.com to resolve.",
        suspended_reason: server.suspended_reason,
      },
      { status: 400 },
    );
  }

  // Customer record + exemption check. Exempt customers (PR D) skip
  // the Stripe live-card check entirely; they're staff/internal/comp
  // accounts that the billing-enforcement workstream doesn't apply to,
  // so requiring a card to restore would be wrong.
  const custRes = await query(
    `SELECT stripe_customer_id, billing_enforcement_exempt FROM customers WHERE id = $1`,
    [principal.customer_id],
  );
  const stripeCustomerId = custRes.rows[0]?.stripe_customer_id as string | undefined;
  const isExempt = !!custRes.rows[0]?.billing_enforcement_exempt;

  if (isExempt) {
    // BOLA defence: customer_id constraint duplicates ownership check.
    // suspended_reason constraint matches the early guard above.
    await query(
      `UPDATE servers
          SET status = 'active',
              suspended_at = NULL,
              suspended_reason = NULL
        WHERE id = $1
          AND customer_id = $2
          AND status = 'suspended'
          AND suspended_reason = 'no_card_on_file'`,
      [serverId, principal.customer_id],
    );
    void writeAudit({
      event,
      principal,
      action: "restore",
      result: "success",
      status_code: 200,
      resource_type: "server",
      resource_id: serverId,
      metadata: { previous_reason: server.suspended_reason ?? "unknown", exempt: true },
    });
    console.log(`[billing-enforcement] restored-exempt customer=${principal.customer_id} server=${serverId}`);
    return json({
      success: true,
      server: { id: server.id, name: server.name, status: "active" },
      message: `${server.name} is active again.`,
    });
  }

  // Stripe-side liveness check. Required even if local state suggests
  // a card was added, because the customer could have removed it again
  // between the page load and this request.
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
    console.warn(`[billing-enforcement] restore stripe-lookup failed customer=${principal.customer_id}: ${err?.message ?? err}`);
    return json({ error: "stripe_lookup_failed" }, { status: 502 });
  }
  if (!hasCard) {
    return json(
      { error: "no_card_on_file", message: "Add a payment method via Manage Subscription before restoring servers." },
      { status: 400 },
    );
  }

  // BOLA defence: although requireServerOwnership() above already
  // confirmed the customer owns this server, we constrain the UPDATE
  // by customer_id as belt-and-suspenders. A ToCToU race between the
  // ownership check and this write is closed by the constraint.
  // suspended_reason constraint matches the early guard above and the
  // restore-all predicate, so a row that flipped reason between the
  // SELECT and this UPDATE can't be reactivated by accident.
  await query(
    `UPDATE servers
        SET status = 'active',
            suspended_at = NULL,
            suspended_reason = NULL
      WHERE id = $1
        AND customer_id = $2
        AND status = 'suspended'
        AND suspended_reason = 'no_card_on_file'`,
    [serverId, principal.customer_id],
  );

  void writeAudit({
    event,
    principal,
    action: "restore",
    result: "success",
    status_code: 200,
    resource_type: "server",
    resource_id: serverId,
    metadata: { previous_reason: server.suspended_reason ?? "unknown" },
  });

  console.log(`[billing-enforcement] restored customer=${principal.customer_id} server=${serverId}`);

  return json({
    success: true,
    server: { id: server.id, name: server.name, status: "active" },
    message: `${server.name} is active again.`,
  });
};
