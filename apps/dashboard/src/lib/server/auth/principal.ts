// Authenticated principal types.
//
// A Principal is what identifies "who is making this request" once
// auth has resolved. Three kinds, in increasing privilege scope:
//
//   - "cru_key"  : a Crucible agent on one server. Can only ship
//                  telemetry for THAT server. Nothing else.
//   - "session"  : a logged-in user via cookie/JWT. Can do anything
//                  the dashboard UI exposes.
//   - "acct_key" : an account API key (gmk_acct_* / gmk_dsh_live_*).
//                  Like "session" but scoped to v1's `servers:manage`
//                  scope set; no UI-only powers (e.g. cannot change
//                  billing).
//   - "oauth"    : a short-lived MCP OAuth access token bound to one
//                  customer, client, grant, resource, and scope set.
//
// The legacy "legacy_session" kind (forge_* per-customer tokens) was
// removed in slice A4 of the "Forge → Dashboard" rename. Code paths
// that previously branched on it now treat the request as
// unauthenticated; programmatic callers must rotate to a fresh
// gmk_dsh_live_* token issued by the dashboard.
//
// All "non-cru_key" principals expose `.customer_id`. Routes use that
// field to feed the `customer_id` SQL constraint that powers BOLA
// resistance (see authz.ts). cru_key principals expose `.server_id`
// directly because they're scoped below the customer level.

export type AuthKind = "session" | "acct_key" | "cru_key" | "oauth";

import type { Capability } from "./capabilities.js";

export interface SessionPrincipal {
  kind: "session";
  customer_id: string;
  email: string;
  plan: string;
}

export interface AcctKeyPrincipal {
  kind: "acct_key";
  customer_id: string;
  /** Row id in account_api_keys. Used for audit-log correlation and rate-limit isolation. */
  key_id: string;
  /** 3-level hierarchical scope: `read` / `write` / `admin`. Checked by
   *  `requireScopeLevel()` in plan.ts. The legacy `scopes` jsonb array
   *  (`["servers:manage"]`) was retired in unify-auth Spec D PR-1; the
   *  underlying DB column is dropped by migration 020. */
  scope: "read" | "write" | "admin";
  /** Opt-in capabilities, additive to `scope` and never implied by it. Empty
   *  for every key created before migration 041. See auth/capabilities.ts. */
  capabilities: Capability[];
  /** Customer plan resolved at lookup time so plan-gated logic
   *  (e.g. audit retention window) doesn't need a separate query. */
  plan: string;
}

export interface CruKeyPrincipal {
  kind: "cru_key";
  /** The single server this key authenticates for. */
  server_id: string;
  /** Customer that owns the server. Useful for cross-checks but routes
   *  generally constrain on server_id directly. */
  customer_id: string;
  /** Null for legacy `col_*` keys (which predate the account_api_keys
   *  schema). After PR #6 migration this field is always set. */
  key_id: string | null;
  /** True if the key is in the legacy `col_*` format vs the new
   *  `gmk_cru_live_*` format. Used by the migration-period middleware
   *  to log usage of the deprecated format. */
  is_legacy_format: boolean;
}

export type OAuthScope =
  | "glassmkr:read"
  | "glassmkr:write"
  | "glassmkr:admin";

export interface OAuthPrincipal {
  kind: "oauth";
  customer_id: string;
  /** Current schema uses the customer as both user and tenant. */
  user_id: string;
  client_id: string;
  client_name: string;
  grant_id: string;
  token_id: string;
  scopes: ReadonlySet<OAuthScope>;
  /** Hierarchical compatibility level for shared authorization helpers. */
  scope: "read" | "write" | "admin";
  plan: string;
  resource: string;
  allowed_origins: ReadonlySet<string>;
}

export type Principal =
  | SessionPrincipal
  | AcctKeyPrincipal
  | CruKeyPrincipal
  | OAuthPrincipal;

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

export function isSession(p: Principal): p is SessionPrincipal {
  return p.kind === "session";
}

export function isAcctKey(p: Principal): p is AcctKeyPrincipal {
  return p.kind === "acct_key";
}

export function isCruKey(p: Principal): p is CruKeyPrincipal {
  return p.kind === "cru_key";
}

export function isOAuth(p: Principal): p is OAuthPrincipal {
  return p.kind === "oauth";
}

/**
 * Returns the customer_id for any non-cru-key principal. cru_key principals
 * also have a customer_id but we expose it via a different accessor to
 * make accidental misuse harder: a cru_key cannot list other servers in
 * the same account, so route code that constrains on `customer_id`
 * (rather than `server_id`) is almost certainly a bug when the principal
 * is a cru_key.
 */
export function principalCustomerId(p: Principal): string {
  return p.customer_id;
}

/** Whether this principal is allowed to act as the "session-level" user
 *  (i.e. anything the UI can do). Used to gate billing changes, etc. */
export function isSessionLevel(p: Principal): boolean {
  return p.kind === "session";
}
