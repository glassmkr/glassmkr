// GET /api/v1/mcp/sessions
// scope: admin
//
// Admin-only visibility into the account's live MCP sessions. Added alongside
// the session reaper (2026-09-16) so an operator can see why the gateway is at
// or near its per-grant / per-account cap instead of only meeting the 429.
//
// Returns the count plus a per-session summary (grant, client, created,
// last-activity, protocol version) for the AUTHENTICATED account only. The
// session map is in-process, which is authoritative because MCP runs on a
// single instance (see warnIfClustered in the gateway).
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import { TIER_PER_KEY, TIER_PER_ACCOUNT } from "$lib/server/auth/rate-limit";
import { getActiveMcpSessionsForCustomer } from "$lib/server/mcp/gateway";
import type { Principal } from "$lib/server/auth/principal";

export const GET: RequestHandler = async (event) => {
  let principal: Principal;
  try {
    principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "list",
      result: "auth_failed",
      status_code: 401,
      resource_type: "mcp_session",
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
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "mcp_session",
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Session listing can echo which clients/grants are connected, so gate it at
  // `admin` (same level as the audit-log read).
  try {
    requireScopeLevel(principal, "admin");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 403,
      resource_type: "mcp_session",
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const result = await getActiveMcpSessionsForCustomer(principal.customer_id);
  void writeAudit({
    event,
    principal,
    action: "list",
    result: "success",
    status_code: 200,
    resource_type: "mcp_session",
    metadata: { count: result.count },
  });
  return json(result);
};
