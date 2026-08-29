// Environment config for Dashboard server-side code.
// Uses process.env directly (SvelteKit populates from .env).
import { SELF_HOSTED } from "$lib/server/self-hosted";

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  telegram: {
    botToken: optional("TELEGRAM_BOT_TOKEN", ""),
    chatId: optional("TELEGRAM_CHAT_ID", ""),
  },

  healthCheckIntervalMinutes: parseInt(optional("HEALTH_CHECK_INTERVAL_MINUTES", "5")),
  dashboardDomain: optional("DASHBOARD_DOMAIN", "app.glassmkr.com"),

  // Redis backs rate-limit token buckets and (in PR #3+) the audit-log
  // write queue. URL format: redis://[user[:pass]@]host[:port][/db]
  // Local dev defaults to a Unix socket on the production host in prod.
  redis: {
    url: optional("REDIS_URL", "redis://127.0.0.1:6379/0"),
    // Set REDIS_DISABLED=1 in local dev environments without a Redis
    // instance available. Rate limit middleware no-ops; auth still works.
    //
    // Self-hosted with no REDIS_URL configured counts as disabled. The bundled
    // compose stack ships no Redis, so the localhost default above pointed at
    // nothing: every rate-limited request (which is every authenticated one)
    // went through a client that could never connect. It degrades open, so it
    // "works", but the client's reconnect backoff grows over time, and a stack
    // that has been up a while stops answering authenticated requests at all.
    // A freshly built one passes a smoke test, which is what made this look
    // like a ClickHouse problem for a while. One process needs no shared
    // bucket, so the in-memory limiter is the right default here.
    disabled:
      optional("REDIS_DISABLED", "") === "1" ||
      (SELF_HOSTED && !(process.env.REDIS_URL ?? "").trim()),
  },

  // HMAC pepper for API key storage. See apps/dashboard/src/lib/server/auth/keys.ts
  // and docs/runbooks/key-pepper-rotation.md (added in PR #1).
  // Read directly via process.env in keys.ts to keep that module
  // independent of this config object; this entry exists here only for
  // documentation completeness.
  // keyPepper: optional("GLASSMKR_KEY_PEPPER", ""),
};
