// scope: read
// GET / PATCH / DELETE /api/v1/servers/{id}
//
// Refactored in PR #4 of the API keys workstream to use the same
// requireAuth + audit + rate-limit + pickAllowedFields stack as
// /api/v1/servers from PR #3.
//
// PATCH is new in this PR. It accepts name and tags only; hostname
// is intentionally not updatable per spec Part 7 (allow ops to find
// a server by hostname even after rename).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";
import { requireAuth } from "$lib/server/auth/require";
import { requireProTierForAcctKey, requireScopeLevel } from "$lib/server/auth/plan";
import { pickAllowedFields } from "$lib/server/auth/allowlist";
import { HOST_PROFILE_IDS } from "$lib/server/alerts/host-profiles";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_KEY,
  TIER_PER_ACCOUNT,
  TIER_SERVERS_DELETE,
} from "$lib/server/auth/rate-limit";
import { requireServerOwnership } from "$lib/server/authz";
import type { Principal } from "$lib/server/auth/principal";
import { getServerForCustomer } from "$lib/server/services/fleet-read";

function validateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > 100) return null;
  return value;
}

function validateTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 20) return null;
  for (const t of value) {
    if (typeof t !== "string" || t.length < 1 || t.length > 50) return null;
  }
  return value as string[];
}

// ============================================================================
// GET /api/v1/servers/{id}
// ============================================================================

export const GET: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "read",
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
      action: "read",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
      resource_id: event.params.id,
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "read",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Pro-tier gate for programmatic callers (acct_key).
  // Codex 2026-05-12 P2: pre-fix the GET only checked scope.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "read",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: GET requires `read`.
  try {
    requireScopeLevel(principal, "read");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "read",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  try {
    // Preserve the route's explicit ownership guard before loading the shared
    // read model. The service independently binds the full query to the same
    // customer so MCP and HTTP callers both retain SQL-level tenant isolation.
    await requireServerOwnership(
      event.params.id ?? "",
      principal.customer_id,
      "id",
    );

    const server = await getServerForCustomer(
      principal.customer_id,
      event.params.id ?? "",
      // Include soft-deleted servers: the trash/restore UI reads a single server
      // through this route and must still see it after a soft delete (behavior
      // that predated the shared fleet-read refactor).
      { includeDeleted: true },
    );
    if (!server) {
      void writeAudit({
        event,
        principal,
        action: "read",
        result: "not_found",
        status_code: 404,
        resource_type: "server",
        resource_id: event.params.id,
      });
      return json({ error: "Server not found" }, { status: 404 });
    }

    void writeAudit({
      event,
      principal,
      action: "read",
      result: "success",
      status_code: 200,
      resource_type: "server",
      resource_id: event.params.id,
    });

    return json({ server });
  } catch (err: any) {
    if (err?.status === 404) {
      void writeAudit({
        event,
        principal,
        action: "read",
        result: "not_found",
        status_code: 404,
        resource_type: "server",
        resource_id: event.params.id,
      });
      throw err;
    }
    console.error("Get server error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "read",
      result: "error",
      status_code: 500,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to get server" }, { status: 500 });
  }
};

// ============================================================================
// PATCH /api/v1/servers/{id}
// ============================================================================
//
// Body (mass-assignment defended):
//   - name (optional, 1-100 chars)
//   - tags (optional, array of <=20 strings, each <=50 chars)
//
// Hostname is NOT updatable per spec Part 7. If a customer needs to
// "rename" a server, they update the display name; hostname is the
// stable identifier that ops uses to find a box across renames.

export const PATCH: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "update",
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
      action: "update",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
      resource_id: event.params.id,
    });
    throw err;
  }

  // Pro-tier gate for acct_key callers. Dashboard sessions on Free
  // continue to rename / retag from the UI.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "update",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: PATCH requires `write`.
  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "update",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "update",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    await requireServerOwnership(
      event.params.id ?? "",
      principal.customer_id,
      "id",
    );

    const rawBody = await event.request.json().catch(() => ({}));
    const fields = pickAllowedFields(rawBody, ["name", "tags", "profile"] as const);

    const updates: string[] = [];
    const params: unknown[] = [];

    if (fields.name !== undefined) {
      const name = validateName(fields.name);
      if (name === null) {
        void writeAudit({
          event,
          principal,
          action: "update",
          result: "invalid",
          status_code: 400,
          resource_type: "server",
          resource_id: event.params.id,
          metadata: { reason: "name" },
        });
        return json(
          { error: "validation_failed", message: "name must be a 1-100 char string" },
          { status: 400 },
        );
      }
      params.push(name);
      updates.push(`name = $${params.length}`);
    }

    if (fields.tags !== undefined) {
      const tags = validateTags(fields.tags);
      if (tags === null) {
        void writeAudit({
          event,
          principal,
          action: "update",
          result: "invalid",
          status_code: 400,
          resource_type: "server",
          resource_id: event.params.id,
          metadata: { reason: "tags" },
        });
        return json(
          { error: "validation_failed", message: "tags must be an array of <=20 strings, each 1-50 chars" },
          { status: 400 },
        );
      }
      params.push(tags);
      updates.push(`tags = $${params.length}`);
    }

    if (fields.profile !== undefined) {
      // null clears the profile; otherwise it must be a known host-type id
      // (host-profiles.ts). The profile expands the server's effective mute
      // set at ingest; see api/v1/ingest/+server.ts.
      const profile = fields.profile;
      if (profile !== null && (typeof profile !== "string" || !HOST_PROFILE_IDS.includes(profile))) {
        void writeAudit({
          event,
          principal,
          action: "update",
          result: "invalid",
          status_code: 400,
          resource_type: "server",
          resource_id: event.params.id,
          metadata: { reason: "profile" },
        });
        return json(
          { error: "validation_failed", message: `profile must be null or one of: ${HOST_PROFILE_IDS.join(", ")}` },
          { status: 400 },
        );
      }
      params.push(profile);
      updates.push(`profile = $${params.length}`);
    }

    if (updates.length === 0) {
      // Nothing to update. Return current row.
      const cur = await query(
        `SELECT id, name, hostname, tags FROM servers WHERE id = $1 AND customer_id = $2`,
        [event.params.id, principal.customer_id],
      );
      void writeAudit({
        event,
        principal,
        action: "update",
        result: "success",
        status_code: 200,
        resource_type: "server",
        resource_id: event.params.id,
        metadata: { changed: [] },
      });
      return json({
        server: {
          id: cur.rows[0].id,
          name: cur.rows[0].name,
          hostname: cur.rows[0].hostname,
          tags: Array.isArray(cur.rows[0].tags) ? cur.rows[0].tags : [],
        },
      });
    }

    // Append the constraint params at the end. The SET clause uses $1..$N
    // and the WHERE uses $N+1, $N+2.
    params.push(event.params.id);
    params.push(principal.customer_id);
    const result = await query(
      `UPDATE servers SET ${updates.join(", ")}
        WHERE id = $${params.length - 1} AND customer_id = $${params.length}
        RETURNING id, name, hostname, tags`,
      params,
    );

    void writeAudit({
      event,
      principal,
      action: "update",
      result: "success",
      status_code: 200,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: {
        changed: Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined),
      },
    });

    return json({
      server: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        hostname: result.rows[0].hostname,
        tags: Array.isArray(result.rows[0].tags) ? result.rows[0].tags : [],
      },
    });
  } catch (err: any) {
    if (err?.status === 404) {
      void writeAudit({
        event,
        principal,
        action: "update",
        result: "not_found",
        status_code: 404,
        resource_type: "server",
        resource_id: event.params.id,
      });
      throw err;
    }
    console.error("Update server error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "update",
      result: "error",
      status_code: 500,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to update server" }, { status: 500 });
  }
};

// ============================================================================
// DELETE /api/v1/servers/{id}?confirm=true
// ============================================================================
//
// Requires ?confirm=true (bare DELETE returns 400). This double-confirm
// is established UI behaviour; programmatic callers also pass it.
//
// Per-endpoint sub-limit: 100 deletes/hour/account.

export const DELETE: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "delete",
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
      action: "delete",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
      resource_id: event.params.id,
    });
    throw err;
  }

  // Pro-tier gate for acct_key callers. Dashboard delete continues to
  // work for Free (the "Delete Server" button on the server detail
  // page goes through this endpoint via session).
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "delete",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: DELETE requires `write`.
  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "delete",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT, TIER_SERVERS_DELETE],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "delete",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  try {
    if (event.url.searchParams.get("confirm") !== "true") {
      void writeAudit({
        event,
        principal,
        action: "delete",
        result: "invalid",
        status_code: 400,
        resource_type: "server",
        resource_id: event.params.id,
        metadata: { reason: "missing_confirm" },
      });
      return json(
        {
          error: "confirm_required",
          message:
            "Pass ?confirm=true to delete. This moves the server to trash: it stops collecting and drops out of your node count, and you can restore it from the dashboard. To destroy it permanently, delete it here first and then call DELETE /api/v1/trashed-servers/{id}.",
        },
        { status: 400 },
      );
    }

    // SOFT delete, since 2026-08-28. This used to be an unqualified row
    // destruction against the servers table, which
    // meant the REST API destroyed data while the MCP tool of the same name
    // moved it to trash: two operations called "delete", both reachable with
    // the same account key, and an agent that learned the restorable behaviour
    // from one lost data using the other. Every interface agrees now, and
    // permanent removal has its own route, capability and name:
    // DELETE /api/v1/trashed-servers/{id}.
    //
    // Single statement: WHERE id = $1 AND customer_id = $2 is the BOLA
    // defence, avoiding a separate ownership SELECT. No row updated -> 404,
    // which also covers a server already in the trash, so a repeated delete is
    // not reported as a fresh success.
    const result = await query(
      `UPDATE servers SET status = 'deleted'
        WHERE id = $1 AND customer_id = $2 AND status = 'active'
      RETURNING id, name`,
      [event.params.id, principal.customer_id],
    );

    if (result.rows.length === 0) {
      void writeAudit({
        event,
        principal,
        action: "delete",
        result: "not_found",
        status_code: 404,
        resource_type: "server",
        resource_id: event.params.id,
      });
      return json({ error: "Server not found" }, { status: 404 });
    }

    await syncSubscriptionQuantitySafe(principal.customer_id);

    void writeAudit({
      event,
      principal,
      action: "delete",
      result: "success",
      status_code: 200,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { deleted_name: result.rows[0].name },
    });

    // State what happened rather than making a client infer it from the verb.
    // These fields are stable contract.
    return json({
      success: true,
      deleted: result.rows[0].name,
      permanent: false,
      restorable: true,
      restore_with: `POST /api/v1/servers/${event.params.id}/restore`,
    });
  } catch (err: any) {
    console.error("Delete server error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "delete",
      result: "error",
      status_code: 500,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to delete server" }, { status: 500 });
  }
};
