// Helper that bundles the modern Pro-gated auth stack for mutation /
// AI / trend-warning endpoints. Pre-existing inline-pattern endpoints
// (servers/[id] PATCH, servers/[id]/mutes, servers/[id]/restore, etc.)
// keep their inline boilerplate — this helper is for endpoints landed
// in the Position-B Pro-gating workstream so each handler stays small.
//
// Stack run, in order, with audit on every throw:
//   enforceIpRateLimit
//   requireAuth({ allow: [session, acct_key] })
//   requireProTierForAcctKey
//   requireScopeLevel (defaults to "write")
//   checkRateLimits
//
// Returns the authenticated Principal on success. Throws on any
// failure with the matching writeAudit row already queued.

import type { RequestEvent } from "@sveltejs/kit";
import { requireAuth } from "./require.js";
import { requireProTierForAcctKey, requireScopeLevel, type ScopeLevel } from "./plan.js";
import { writeAudit } from "./audit.js";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "./rate-limit-middleware.js";
import { TIER_PER_KEY, TIER_PER_ACCOUNT } from "./rate-limit.js";
import type { Principal } from "./principal.js";

export type AuditAction = "read" | "list" | "create" | "update" | "delete" | "rotate" | string;
export type AuditResourceType = "server" | "alert" | "channel" | "trend_warning" | "analysis" | "account" | "key" | string;

export interface ProGatedAuthOpts {
  /** Audit action label (read/update/delete/etc.). */
  action: AuditAction;
  /** What kind of resource the call targets. */
  resource_type: AuditResourceType;
  /** Optional resource id for the audit row. */
  resource_id?: string | null;
  /** Hierarchical scope ("read" / "write" / "admin"). Defaults to "write" for mutation helpers.
   *  The legacy `requiredScope` option (v1 boolean scope) was removed in
   *  unify-auth Spec D PR-1; every caller already passed `scopeLevel`
   *  explicitly so the removal is a pure rename. */
  scopeLevel?: ScopeLevel;
  /** Auth-allow list. Defaults to programmatic-API-compatible. */
  allow?: ("session" | "acct_key")[];
  /**
   * When false, the Pro-tier gate is skipped. Use for Position-B
   * "reads stay Free" endpoints: read of own data via any auth path
   * (session or acct_key) must work at any tier. Defaults to true,
   * matching the helper's primary use case (mutation endpoints that
   * need the Pro gate).
   */
  proGated?: boolean;
}

export class ProGatedAuthFailed extends Error {
  constructor(public response: Response) {
    super("rate limited");
  }
}

/**
 * Returns the authenticated Principal or throws.
 *
 * Two throw shapes:
 *   - SvelteKit `error()` for auth/scope/tier/scope-level (handled by
 *     SvelteKit's error boundary).
 *   - `ProGatedAuthFailed` carrying a pre-built `Response` for rate
 *     limit cases. The caller catches it and returns `.response`.
 *
 * The rate-limit case is wrapped so the caller doesn't have to know
 * whether it's an IP-tier or per-key-tier limit; both look the same
 * to the handler.
 */
export async function requireProGatedAuth(
  event: RequestEvent,
  opts: ProGatedAuthOpts,
): Promise<Principal> {
  const allow = opts.allow ?? ["session", "acct_key"];
  const scopeLevel = opts.scopeLevel ?? "write";
  const auditBase = {
    event,
    action: opts.action,
    resource_type: opts.resource_type,
    resource_id: opts.resource_id ?? undefined,
  };

  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      ...auditBase, principal: null,
      result: "rate_limited", status_code: 429,
      metadata: { tier: ipFail.failure.tier },
    });
    throw new ProGatedAuthFailed(rateLimitedResponse(ipFail.failure));
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, { allow });
  } catch (err) {
    void writeAudit({
      ...auditBase, principal: null,
      result: "auth_failed", status_code: 401,
    });
    throw err;
  }

  // Skip the Pro gate when the caller opted out (Position-B reads).
  // Defaults to true.
  if (opts.proGated !== false) try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      ...auditBase, principal,
      result: "forbidden", status_code: 402,
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  try {
    requireScopeLevel(principal, scopeLevel);
  } catch (err: any) {
    void writeAudit({
      ...auditBase, principal,
      result: "forbidden", status_code: 403,
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event, principal, tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      ...auditBase, principal,
      result: "rate_limited", status_code: 429,
      metadata: { tier: rl.tier },
    });
    throw new ProGatedAuthFailed(rateLimitedResponse(rl));
  }

  return principal;
}
