// Idempotency-Key support for non-idempotent (POST) endpoints.
//
// Stripe-style: caller sends `Idempotency-Key: <opaque uuid>`. If a
// request with the same key is retried within the cache window (24h),
// the cached response (status + body) is returned exactly. Whether the
// original was 2xx, 4xx, or 5xx, the retry sees the same outcome.
//
// P1.6 fix: the slot is reserved atomically via SET NX with a short
// TTL "in-flight" sentinel. Two concurrent requests with the same
// idempotency key cannot both reach the create path. The second
// request gets `in_flight` and the handler returns 409 telling the
// caller to retry; once the first completes and writes the final
// response under 24h TTL, the retry sees `replay`.
//
// Backed by Redis. Cache key:
//   idem:{owner}:{scope}:{idempotency_key}
//
// The cached value contains the response body and status. Headers are
// not cached because (a) they vary by request_id which would make the
// cache useless, and (b) the customer-visible contract is the status
// + body. Stripe behaves the same way.

import type { RequestEvent } from "@sveltejs/kit";
import { getRedis } from "../redis.js";
import type { Principal } from "./principal.js";

export interface IdempotencyEntry {
  status: number;
  body: unknown;
}

export type IdempotencyResult =
  | { kind: "fresh"; key: string }
  | { kind: "replay"; cached: IdempotencyEntry }
  | { kind: "in_flight" }
  | { kind: "no_key" };

const TTL_SECONDS = 24 * 60 * 60;
/** Short TTL for the in-flight sentinel; if the original handler crashes
 *  mid-request, the slot self-heals after this window so retries can
 *  proceed. Should comfortably cover the longest plausible request. */
const INFLIGHT_TTL_SECONDS = 60;
const INFLIGHT_SENTINEL = "__inflight__";

function buildKey(principal: Principal, scope: string, idemKey: string): string {
  // Hash the user-supplied key into the namespace? Not necessary —
  // the idemKey is supplied by the customer's automation and is theirs
  // to choose. We DO scope it to (customer_id, route) so two customers
  // can use the same key without collision.
  const ownerId =
    principal.kind === "cru_key" ? principal.server_id : principal.customer_id;
  return `idem:${ownerId}:${scope}:${idemKey}`;
}

/**
 * Check the Idempotency-Key header. If present and we've seen it
 * before within the cache window, return the cached response. If
 * present and fresh, returns the validated key for the route to
 * pass to {@link recordIdempotency} after computing the response.
 *
 * If absent, returns `no_key` and the route proceeds without
 * idempotency tracking. Idempotency is opt-in: the customer can
 * skip it for write requests where they don't care about retry
 * safety.
 *
 * Validation: the key must be 1-255 chars of printable ASCII.
 * Anything else is treated as no_key (defensive; we don't 400 the
 * request just because the idempotency header is wrong).
 */
export async function checkIdempotency(opts: {
  event: RequestEvent;
  principal: Principal;
  scope: string;
}): Promise<IdempotencyResult> {
  const headerKey = opts.event.request.headers.get("idempotency-key");
  if (headerKey === null) return { kind: "no_key" };

  const trimmed = headerKey.trim();
  if (trimmed.length === 0 || trimmed.length > 255 || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return { kind: "no_key" };
  }

  const redis = getRedis();
  if (redis === null) {
    // Redis disabled or unavailable. Treat as fresh (no caching, but
    // we don't fail the request).
    return { kind: "fresh", key: trimmed };
  }

  const cacheKey = buildKey(opts.principal, opts.scope, trimmed);
  try {
    // Atomically reserve the slot. SET NX returns "OK" only if the key
    // didn't exist. This is the race-safe primitive that prevents two
    // concurrent requests from both reaching the create path.
    const setResult = await redis.set(
      cacheKey,
      INFLIGHT_SENTINEL,
      "EX",
      INFLIGHT_TTL_SECONDS,
      "NX",
    );
    if (setResult === "OK") {
      return { kind: "fresh", key: trimmed };
    }

    // Slot already reserved or already cached. Read to discriminate.
    const existing = await redis.get(cacheKey);
    if (existing === null) {
      // Race: someone deleted it between our SET-NX and our GET.
      // Try once more.
      const retry = await redis.set(
        cacheKey,
        INFLIGHT_SENTINEL,
        "EX",
        INFLIGHT_TTL_SECONDS,
        "NX",
      );
      if (retry === "OK") return { kind: "fresh", key: trimmed };
      return { kind: "in_flight" };
    }
    if (existing === INFLIGHT_SENTINEL) return { kind: "in_flight" };
    try {
      return { kind: "replay", cached: JSON.parse(existing) as IdempotencyEntry };
    } catch {
      // Corrupted cache value; treat as fresh (caller proceeds without
      // idempotency tracking for this request).
      return { kind: "fresh", key: trimmed };
    }
  } catch (err) {
    console.error("[idempotency] Redis read failed:", (err as Error).message);
    return { kind: "fresh", key: trimmed };
  }
}

/**
 * Build a 409 Conflict response for an in-flight idempotency key.
 * Caller should return this directly when {@link checkIdempotency}
 * yields `in_flight`.
 */
export function inFlightResponse(): Response {
  const body = {
    error: "idempotency_key_conflict",
    message:
      "An earlier request with this Idempotency-Key is still being processed. " +
      "Wait for it to complete before retrying, or use a different key.",
    documentation_url: "https://glassmkr.com/docs/programmatic-api#idempotency",
  };
  return new Response(JSON.stringify(body), {
    status: 409,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": "5",
    },
  });
}

/**
 * Record a response for an idempotency key. Sets a 24h TTL.
 *
 * Errors are logged and swallowed: a failure to write the cache means
 * the next retry won't be served from cache (which is the same as if
 * idempotency was off). It does NOT change the customer-visible
 * response.
 */
export async function recordIdempotency(opts: {
  principal: Principal;
  scope: string;
  key: string;
  response: IdempotencyEntry;
}): Promise<void> {
  const redis = getRedis();
  if (redis === null) return;
  const cacheKey = buildKey(opts.principal, opts.scope, opts.key);
  try {
    await redis.set(cacheKey, JSON.stringify(opts.response), "EX", TTL_SECONDS);
  } catch (err) {
    console.error("[idempotency] Redis write failed:", (err as Error).message);
  }
}
