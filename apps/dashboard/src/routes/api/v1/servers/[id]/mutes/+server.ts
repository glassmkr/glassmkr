// scope: read
// GET / POST / DELETE /api/v1/servers/{id}/mutes
//
// Pre-fix: this route checked `event.locals.customer` directly, which
// is only set for browser-session callers. Programmatic acct_key
// callers (validation API key and customer-issued API keys both)
// 401'd unconditionally, leaving mutes UI-only. Refactored to the
// same requireAuth + audit + rate-limit + scope stack as
// /api/v1/servers/[id], so an acct_key with `servers:manage` +
// `write` scope can apply / remove mutes the same way it can patch
// name/tags or set config_overrides. Pro-tier gate applies for
// acct_key callers (session callers on Free continue to use the UI).
// glassmkr#? (mute API gating Task A, 2026-05-13).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import { requireProTierForAcctKey, requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import { TIER_PER_KEY, TIER_PER_ACCOUNT } from "$lib/server/auth/rate-limit";
import { requireServerOwnership } from "$lib/server/authz";
import type { Principal } from "$lib/server/auth/principal";

// GET /api/v1/servers/:id/mutes - list muted rules
export const GET: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event, principal: null, action: "read",
      result: "rate_limited", status_code: 429,
      resource_type: "server", resource_id: event.params.id,
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
      event, principal: null, action: "read",
      result: "auth_failed", status_code: 401,
      resource_type: "server", resource_id: event.params.id,
    });
    throw err;
  }

  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event, principal, action: "read",
      result: "forbidden", status_code: 402,
      resource_type: "server", resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  try {
    requireScopeLevel(principal, "read");
  } catch (err: any) {
    void writeAudit({
      event, principal, action: "read",
      result: "forbidden", status_code: 403,
      resource_type: "server", resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event, principal, tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event, principal, action: "read",
      result: "rate_limited", status_code: 429,
      resource_type: "server", resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    const row = await requireServerOwnership(
      event.params.id ?? "",
      principal.customer_id,
      "muted_rules",
    );
    return json({ muted_rules: (row.muted_rules as string[] | null) ?? [] });
  } catch (err: any) {
    if (err?.status) throw err;
    console.error("Get mutes error:", err.message);
    return json({ error: "Failed to get muted rules" }, { status: 500 });
  }
};

// POST /api/v1/servers/:id/mutes - mute a rule
// Body: { alert_type: "interface_errors" }
export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event, principal: null, action: "update",
      result: "rate_limited", status_code: 429,
      resource_type: "server", resource_id: event.params.id,
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
      event, principal: null, action: "update",
      result: "auth_failed", status_code: 401,
      resource_type: "server", resource_id: event.params.id,
    });
    throw err;
  }

  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event, principal, action: "update",
      result: "forbidden", status_code: 402,
      resource_type: "server", resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event, principal, action: "update",
      result: "forbidden", status_code: 403,
      resource_type: "server", resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event, principal, tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event, principal, action: "update",
      result: "rate_limited", status_code: 429,
      resource_type: "server", resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    const body = await event.request.json().catch(() => ({})) as { alert_type?: string };
    if (!body.alert_type || typeof body.alert_type !== "string") {
      void writeAudit({
        event, principal, action: "update",
        result: "invalid", status_code: 400,
        resource_type: "server", resource_id: event.params.id,
      });
      return json({ error: "alert_type is required" }, { status: 400 });
    }

    const row = await requireServerOwnership(
      event.params.id ?? "",
      principal.customer_id,
      "id, muted_rules",
    );

    const current = (row.muted_rules as string[] | null) ?? [];
    if (current.includes(body.alert_type)) {
      return json({ muted_rules: current, message: "Rule already muted" });
    }

    const updated = [...current, body.alert_type];
    // bola-exempt: requireServerOwnership above already verified the
    // serverId belongs to principal.customer_id, so this bare-id
    // UPDATE cannot cross-tenant.
    await query(
      `UPDATE servers SET muted_rules = $1 WHERE id = $2`,
      [JSON.stringify(updated), event.params.id],
    );

    // Resolve any active alerts of this type for this server so the
    // mute takes effect immediately rather than waiting for next
    // ingest.
    await query(
      `UPDATE active_alerts SET resolved_at = NOW()
       WHERE server_id = $1 AND alert_type = $2 AND resolved_at IS NULL`,
      [event.params.id, body.alert_type],
    );

    void writeAudit({
      event, principal, action: "update",
      result: "success", status_code: 200,
      resource_type: "server", resource_id: event.params.id,
      metadata: { mute_added: body.alert_type, muted_count: updated.length },
    });
    return json({ muted_rules: updated, message: `Rule ${body.alert_type} muted` });
  } catch (err: any) {
    if (err?.status) throw err;
    console.error("Mute error:", err.message);
    return json({ error: "Failed to mute rule" }, { status: 500 });
  }
};

// DELETE /api/v1/servers/:id/mutes - unmute a rule
// Body: { alert_type: "interface_errors" }
export const DELETE: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event, principal: null, action: "delete",
      result: "rate_limited", status_code: 429,
      resource_type: "server", resource_id: event.params.id,
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
      event, principal: null, action: "delete",
      result: "auth_failed", status_code: 401,
      resource_type: "server", resource_id: event.params.id,
    });
    throw err;
  }

  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event, principal, action: "delete",
      result: "forbidden", status_code: 402,
      resource_type: "server", resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event, principal, action: "delete",
      result: "forbidden", status_code: 403,
      resource_type: "server", resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event, principal, tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event, principal, action: "delete",
      result: "rate_limited", status_code: 429,
      resource_type: "server", resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    const body = await event.request.json().catch(() => ({})) as { alert_type?: string };
    if (!body.alert_type || typeof body.alert_type !== "string") {
      void writeAudit({
        event, principal, action: "delete",
        result: "invalid", status_code: 400,
        resource_type: "server", resource_id: event.params.id,
      });
      return json({ error: "alert_type is required" }, { status: 400 });
    }

    const row = await requireServerOwnership(
      event.params.id ?? "",
      principal.customer_id,
      "id, muted_rules",
    );

    const current = (row.muted_rules as string[] | null) ?? [];
    const updated = current.filter((r) => r !== body.alert_type);

    // bola-exempt: requireServerOwnership above already verified the
    // serverId belongs to principal.customer_id; this bare-id UPDATE
    // cannot cross-tenant.
    await query(
      `UPDATE servers SET muted_rules = $1 WHERE id = $2`,
      [JSON.stringify(updated), event.params.id],
    );

    void writeAudit({
      event, principal, action: "delete",
      result: "success", status_code: 200,
      resource_type: "server", resource_id: event.params.id,
      metadata: { mute_removed: body.alert_type, muted_count: updated.length },
    });
    return json({ muted_rules: updated, message: `Rule ${body.alert_type} unmuted` });
  } catch (err: any) {
    if (err?.status) throw err;
    console.error("Unmute error:", err.message);
    return json({ error: "Failed to unmute rule" }, { status: 500 });
  }
};
