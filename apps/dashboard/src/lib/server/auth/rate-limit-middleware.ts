// Composes the multiple rate-limit tiers into a single per-route check.
//
// A typical management endpoint runs three checks in order:
//   1. per-IP   (catches scrapers / brute force before auth)
//   2. per-key  (one runaway script doesn't monopolise the customer's quota)
//   3. per-account (fairness across all of one customer's automation)
// Plus optionally a per-endpoint sub-limit (e.g. 100 server creates/hour).
//
// First failure short-circuits. The structured result tells the caller
// which tier failed so the 429 response can include `tier` in the body
// (spec Part 5).
//
// Header conventions (per spec Part 5):
//   X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset are NOT set
//   in this PR. The response shape spec calls for `Retry-After` only on
//   429s; other headers are nice-to-have and added in a future iteration.

import type { RequestEvent } from "@sveltejs/kit";
import {
  take,
  type RateLimitConfig,
  type RateLimitResult,
} from "./rate-limit.js";
import type { Principal } from "./principal.js";
import { getSourceIp } from "./source-ip.js";

export interface CheckRateLimitsOptions {
  event: RequestEvent;
  /** Authenticated principal, or null if the route is pre-auth. */
  principal: Principal | null;
  /** Tiers to check, in order. First failure short-circuits. */
  tiers: ReadonlyArray<RateLimitConfig>;
}

export type CheckRateLimitsResult =
  | { allowed: true; degraded: boolean }
  | {
      allowed: false;
      tier: string;
      retryAfterSeconds: number;
      remaining: number;
    };

/**
 * Identifier for one tier given the request. Returns null if the tier
 * doesn't apply (e.g. per-account when the request is unauthenticated).
 *
 * Convention: namespace prefix tells us how to derive the identifier.
 *   "ip"            -> source IP
 *   "key"           -> key_id (acct or cru); falls back to customer_id
 *   "acct"          -> customer_id; null if no principal
 *   "ep:*"          -> per-endpoint, scoped to customer_id
 *   anything else   -> source IP
 */
function identifierFor(tier: RateLimitConfig, event: RequestEvent, principal: Principal | null): string | null {
  if (tier.namespace === "ip") {
    return getSourceIp(event);
  }
  if (tier.namespace === "key") {
    if (principal?.kind === "acct_key") return principal.key_id;
    if (principal?.kind === "cru_key" && principal.key_id) return principal.key_id;
    if (principal?.kind === "oauth") return principal.token_id;
    if (principal && principal.kind !== "cru_key") return principal.customer_id;
    return null;
  }
  if (tier.namespace === "acct" || tier.namespace.startsWith("ep:")) {
    if (principal && principal.kind !== "cru_key") return principal.customer_id;
    if (principal?.kind === "cru_key") return principal.customer_id;
    return null;
  }
  return getSourceIp(event);
}

/**
 * Optional override for `enforceIpRateLimit`. Lets specific routes use a
 * different bucket than the generic management tier when their traffic
 * profile is fundamentally different.
 *
 * Codex F3 fix 2026-05-22: the generic `{capacity: 100, refillPerSecond: 10}`
 * suits a browser/tool hitting a management endpoint with one IP = one
 * client. It does NOT suit the ingest endpoint, where one egress IP can
 * be a NAT/SNAT covering a whole fleet of collectors. A 200-collector
 * fleet booting simultaneously easily overruns the 100-burst before they
 * even reach the per-server `lastIngest` limit. The new override lets
 * `/api/v1/ingest` carve out its own `ip:ingest` bucket with a fleet-sized
 * capacity, leaving the management default intact.
 */
export interface IpRateLimitOverride {
  /** Capacity (burst). Defaults to 100. */
  capacity?: number;
  /** Refill rate per second. Defaults to 10. */
  refillPerSecond?: number;
  /**
   * Sub-namespace appended to "ip" (e.g. "ingest" -> "ip:ingest") so the
   * route's bucket is isolated from the generic management bucket. When
   * omitted, the route shares the default "ip" bucket.
   */
  namespaceSuffix?: string;
}

/**
 * Pre-auth gate: debit one token from the per-IP bucket BEFORE auth runs.
 *
 * Why: spec Part 5 says "a failed auth attempt costs a token". If we
 * only debit after requireAuth succeeds, malformed or guessed keys
 * never burn a token, and an attacker can hammer one IP forever
 * without being rate-limited. Calling this in every management
 * handler before requireAuth restores the brute-force defence.
 *
 * Returns `null` when allowed. Returns a built 429 Response when the
 * bucket is empty. Caller should write an audit row and return the
 * response; we don't write audit here because the principal is unknown
 * (which is the whole point of pre-auth).
 */
export async function enforceIpRateLimit(
  event: RequestEvent,
  override: IpRateLimitOverride = {},
): Promise<{ failure: Extract<CheckRateLimitsResult, { allowed: false }> } | null> {
  const namespace = override.namespaceSuffix
    ? `ip:${override.namespaceSuffix}`
    : "ip";
  const result: RateLimitResult = await take(
    {
      namespace,
      capacity: override.capacity ?? 100,
      refillPerSecond: override.refillPerSecond ?? 10,
    },
    getSourceIp(event),
  );
  if (!result.allowed) {
    return {
      failure: {
        allowed: false,
        tier: namespace,
        retryAfterSeconds: result.retryAfterSeconds,
        remaining: 0,
      },
    };
  }
  return null;
}

/**
 * Run all configured tiers. Returns the first failure or `allowed: true`.
 *
 * `degraded: true` in the success path signals that one or more tiers
 * couldn't reach Redis and were let through on the fail-open policy.
 * Routes can use this to log the degradation; functionality is unchanged.
 */
export async function checkRateLimits(
  opts: CheckRateLimitsOptions,
): Promise<CheckRateLimitsResult> {
  let anyDegraded = false;
  for (const tier of opts.tiers) {
    const id = identifierFor(tier, opts.event, opts.principal);
    if (id === null) continue;

    const result: RateLimitResult = await take(tier, id);
    if (result.degraded) anyDegraded = true;
    if (!result.allowed) {
      return {
        allowed: false,
        tier: tier.namespace,
        retryAfterSeconds: result.retryAfterSeconds,
        remaining: 0,
      };
    }
  }
  return { allowed: true, degraded: anyDegraded };
}

// ---------------------------------------------------------------------------
// 429 response builder
// ---------------------------------------------------------------------------

/**
 * Build the 429 JSON response per spec Part 5.
 *
 * Includes `tier` in the body so the client knows whether the right
 * back-off is "all your scripts" (per_account) or "this one script"
 * (per_key). Sets Retry-After header.
 */
export function rateLimitedResponse(
  failure: Extract<CheckRateLimitsResult, { allowed: false }>,
): Response {
  const body = {
    error: "rate_limit_exceeded",
    tier: failure.tier,
    retry_after_seconds: failure.retryAfterSeconds,
    documentation_url: "https://glassmkr.com/docs/programmatic-api#rate-limits",
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(failure.retryAfterSeconds),
    },
  });
}
