// Redis client wrapper.
//
// Dashboard uses Redis for:
//   - Rate-limit token buckets (per-IP, per-key, per-account)
//   - In PR #3+: audit log buffered writes if PG insert is slow
//
// Connection model:
//   - Single ioredis client per Node process. ioredis handles auto-reconnect,
//     backoff, and connection pooling internally.
//   - Lazy connect: the connection is opened on first use, not at module
//     import. This keeps build-time / SSR pre-render paths from failing
//     when Redis is unreachable.
//   - REDIS_DISABLED=1 short-circuits all calls to no-ops. Useful for local
//     dev without a Redis instance and for the build-time SvelteKit pass.
//
// Operational note: the production host runs Redis 7.x as a systemd unit
// (`glassmkr-redis.service`), bound to 127.0.0.1:6379. No external network
// exposure. AUTH is not used because the bind is loopback-only and the
// host is single-tenant. If Redis ever moves to a separate host or VM,
// switch to a network bind with TLS + AUTH; the URL format already supports
// it.

import Redis, { type RedisOptions } from "ioredis";
import { config } from "./config.js";

let client: Redis | null = null;

/**
 * Lazily-instantiated Redis client. Returns null when Redis is disabled
 * via REDIS_DISABLED=1; callers must handle the null case (typically by
 * skipping the rate limit or audit operation).
 *
 * Do not call this at module top-level; call it inside the function that
 * needs Redis. Otherwise SvelteKit's build / prerender pass will try to
 * connect.
 */
export function getRedis(): Redis | null {
  if (config.redis.disabled) return null;
  if (client !== null) return client;

  const opts: RedisOptions = {
    // Match Dashboard's general retry shape: don't retry forever; fail closed
    // and let the rate-limit middleware degrade open (allow request) on
    // Redis unavailability rather than 500-ing customer traffic.
    maxRetriesPerRequest: 3,
    // Exponential-ish reconnect backoff. Caps at 5s so failed Redis
    // doesn't spin the event loop.
    retryStrategy: (times) => Math.min(50 * 2 ** Math.min(times, 7), 5000),
    // Avoid loud reconnect storms in logs during transient outages.
    reconnectOnError: () => false,
    // Lazy: actually connect when first command runs.
    lazyConnect: true,
    enableAutoPipelining: true,
  };

  client = new Redis(config.redis.url, opts);

  client.on("error", (err) => {
    // Logged but not thrown. Rate-limit middleware checks the connection
    // state on each call and degrades gracefully if Redis is down.
    console.error("[redis] connection error:", err.message);
  });

  return client;
}

/**
 * Test-only: replace the singleton client. Pass null to clear.
 * @internal
 */
export function setRedisForTests(c: Redis | null): void {
  client = c;
}

/**
 * Drain the client connection. Used in tests and (eventually) graceful
 * shutdown handlers.
 */
export async function quitRedis(): Promise<void> {
  if (client === null) return;
  try {
    await client.quit();
  } catch {
    // Force-close if quit fails (already disconnected, etc.)
    client.disconnect();
  }
  client = null;
}
