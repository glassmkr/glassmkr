// scope: admin
// Permanent purge of a trashed server.
//
// This is the destructive half of what used to be one ambiguous operation. Until
// 2026-08-28, DELETE /servers/{id} destroyed the row while the MCP tool of the
// same name moved it to trash: two behaviours, one word, both reachable with the
// same account key. An agent that learned "delete is restorable" from the MCP
// tool description and then used REST lost data it believed it could recover.
//
// The split:
//   DELETE /servers/{id}            soft. Moves to trash. Restorable. write scope.
//   DELETE /trashed-servers/{id}    this. Destroys the row and its metrics.
//
// Four independent conditions, because the whole point is that this cannot be
// reached by accident or by a client that thought it was calling the other one:
//
//   1. The server must ALREADY be in the trash. You cannot purge a live server
//      in one call, so the soft delete is an unavoidable first step and the
//      trash is a real waiting room rather than a formality.
//   2. `?confirm=true`, same as the soft delete.
//   3. Recent re-authentication, so a leaked key alone is not enough.
//   4. The `servers:purge` capability, which is opt-in and NOT implied by admin
//      scope. Every key that existed before migration 041 holds none, so
//      nothing that works today gains this power by deploying it.
//
// Deliberately absent from MCP. The MCP surface offers soft delete and restore;
// an agent has no path to permanent destruction at all.
import { json } from "@sveltejs/kit";
import { query } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { requireRecentReAuth } from "$lib/server/auth/reauth";
import { principalHasCapability } from "$lib/server/auth/capabilities";
import { writeAudit } from "$lib/server/auth/audit";
import { apiErrorBody } from "$lib/server/api/errors";
import { enforceIpRateLimit, rateLimitedResponse } from "$lib/server/auth/rate-limit-middleware";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";
import type { Principal } from "$lib/server/auth/principal";
import type { RequestHandler } from "./$types";

// tier: free
//
// Permanent purge is NOT a Pro feature. The plan gates node count, metric
// retention and AI analysis; being able to finish deleting your own data is not
// something to sell back to a Free account, and a paywall on the destructive
// half of a delete would leave trashed servers stranded. The gate on this route
// is the servers:purge capability plus recent re-authentication, which is an
// authorization question rather than a billing one.
export const DELETE: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "purge",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      resource_id: event.params.id,
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "purge",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
      resource_id: event.params.id,
    });
    throw err;
  }

  requireScopeLevel(principal, "admin");

  // The capability gate. A session is refused here too: the dashboard's trash
  // offers restore, not destroy, so a session reaching this endpoint means
  // something built a request the interface cannot produce.
  if (principal.kind !== "acct_key" || !principalHasCapability(principal, "servers:purge")) {
    void writeAudit({
      event,
      principal,
      action: "purge",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "missing_capability" },
    });
    return json(
      apiErrorBody({
        status: 403,
        code: "missing_capability",
        message:
          "Permanent purge requires an account key holding the servers:purge capability. It is opt-in and is not granted by admin scope, so keys created before it existed do not have it. Create a new key with the capability, or restore the server instead.",
        requestId: event.locals.request_id ?? null,
        details: [{ required_capability: "servers:purge" }],
      }),
      { status: 403 },
    );
  }

  // A leaked key alone must not be enough to destroy data.
  await requireRecentReAuth(principal.customer_id);

  if (event.url.searchParams.get("confirm") !== "true") {
    void writeAudit({
      event,
      principal,
      action: "purge",
      result: "invalid",
      status_code: 400,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { reason: "missing_confirm" },
    });
    return json(
      apiErrorBody({
        status: 400,
        code: "confirm_required",
        message:
          "Pass ?confirm=true to purge. This destroys the server row and its stored metrics. Nothing restores it.",
        requestId: event.locals.request_id ?? null,
      }),
      { status: 400 },
    );
  }

  try {
    // status = 'deleted' in the WHERE clause is the "must already be trashed"
    // condition AND part of the BOLA defence. A live server does not match, so
    // it answers 409 below rather than being destroyed in one call.
    const result = await query(
      `DELETE FROM servers
        WHERE id = $1 AND customer_id = $2 AND status = 'deleted'
      RETURNING id, name`,
      [event.params.id, principal.customer_id],
    );

    if (result.rows.length === 0) {
      // Distinguish "not yours / never existed" from "still live", because the
      // second is recoverable by the client and the first is not. Both are
      // scoped by customer_id, so neither leaks another tenant's existence.
      const live = await query(
        `SELECT id FROM servers WHERE id = $1 AND customer_id = $2 AND status <> 'deleted'`,
        [event.params.id, principal.customer_id],
      );
      const stillLive = live.rows.length > 0;
      void writeAudit({
        event,
        principal,
        action: "purge",
        result: stillLive ? "invalid" : "not_found",
        status_code: stillLive ? 409 : 404,
        resource_type: "server",
        resource_id: event.params.id,
        metadata: stillLive ? { reason: "not_trashed" } : undefined,
      });
      return stillLive
        ? json(
            apiErrorBody({
              status: 409,
              code: "not_trashed",
              message:
                "This server is still active. Purge only removes a server that is already in the trash: call DELETE /api/v1/servers/{id}?confirm=true first, then purge it.",
              requestId: event.locals.request_id ?? null,
            }),
            { status: 409 },
          )
        : json(
            apiErrorBody({
              status: 404,
              message: "Server not found.",
              requestId: event.locals.request_id ?? null,
            }),
            { status: 404 },
          );
    }

    await syncSubscriptionQuantitySafe(principal.customer_id);

    void writeAudit({
      event,
      principal,
      action: "purge",
      result: "success",
      status_code: 200,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { purged_name: result.rows[0].name },
    });

    return json({
      success: true,
      purged: result.rows[0].name,
      permanent: true,
      restorable: false,
    });
  } catch (err: any) {
    console.error("Purge server error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "purge",
      result: "error",
      status_code: 500,
      resource_type: "server",
      resource_id: event.params.id,
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json(
      apiErrorBody({
        status: 500,
        message: "Failed to purge server.",
        requestId: event.locals.request_id ?? null,
      }),
      { status: 500 },
    );
  }
};
