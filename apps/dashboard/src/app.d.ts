import type { CustomerPayload } from "@glassmkr/db/types";

declare global {
  namespace App {
    interface Locals {
      customer: CustomerPayload | null;
      // Which auth path populated `customer`. "session" = JWT cookie
      // / Bearer (real dashboard / browser session). The legacy
      // "legacy_session" kind (forge_* per-customer bearer tokens)
      // was removed in slice A4 of the rename; programmatic callers
      // now use gmk_acct_live_* / gmk_dsh_live_* account API keys
      // resolved by the per-route auth helpers in $lib/server/auth,
      // not by this middleware. Null when no auth ran or auth failed.
      authKind: "session" | null;
      /** Server-generated correlation ID shared by response, audit, and MCP output. */
      request_id: string;
    }
    // Shape returned by handleError in hooks.{client,server}.ts.
    // SvelteKit's default is `{ message: string }`; we extend it
    // with a short error ID the user can reference in a bug report,
    // and the full Sentry/GlitchTip event UUID for cross-lookup.
    interface Error {
      message: string;
      errorId?: string;
      sentryEventId?: string | null;
      // The machine envelope handleError adds for /api/ paths. Optional
      // because pages keep the shape above, and because a callsite that has
      // not been given an explicit `code` yet still gets one derived from the
      // status. See lib/server/api/errors.ts.
      code?: string;
      error?: string;
      request_id?: string | null;
      documentation_url?: string;
      retryable?: boolean;
      retry_after_seconds?: number | null;
      details?: unknown[];
    }
  }
}

export {};
