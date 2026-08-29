// Route-level authentication helper.
//
// Used at the top of every route handler that needs auth:
//
//   const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
//   const server = await requireServerOwnership(params.id, principal.customer_id);
//
// The `allow` list is the key-separation invariant from spec Part 2:
// management endpoints accept `session` + `acct_key` but refuse `cru_key`;
// the ingest endpoint accepts only `cru_key`. Mismatches return a 401
// with a hint in the body so customers can recognise the wrong-key-type
// case without leaking which prefix exists.

import { error, type RequestEvent } from "@sveltejs/kit";
import { parseKey } from "./keys.js";
import { lookupAcctKey, lookupCruKey } from "./lookup.js";
import type { AuthKind, Principal } from "./principal.js";

export interface RequireAuthOptions {
  /** Which auth kinds this endpoint accepts. Order matters only when
   *  generating the WWW-Authenticate hint; auth is short-circuited at
   *  the first matching tier regardless. */
  allow: ReadonlyArray<AuthKind>;
}

/**
 * Resolve the request principal or throw a 401.
 *
 * Looks at:
 *   1. event.locals.customer (populated by hooks.server.ts for the
 *      dashboard browser session — JWT cookie or Bearer header)
 *   2. The Authorization: Bearer gmk_* header for the new key formats
 *
 * Throws a 401 SvelteKit error with a structured body that includes a
 * machine-readable error code ("auth_required" | "auth_failed" |
 * "wrong_key_type") and never leaks which check failed beyond what's
 * useful to the legitimate caller.
 */
export async function requireAuth(
  event: RequestEvent,
  options: RequireAuthOptions,
): Promise<Principal> {
  const allow = new Set(options.allow);

  // Tier 1: session principal already resolved by hooks.server.ts.
  if (event.locals.customer && event.locals.authKind === "session") {
    if (allow.has("session")) {
      const c = event.locals.customer;
      return {
        kind: "session",
        customer_id: c.id,
        email: c.email,
        plan: c.plan,
      };
    }
  }

  // Tier 2: gmk_* bearer tokens.
  const authHeader = event.request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer gmk_")) {
    const raw = authHeader.slice(7).trim();
    const parsed = parseKey(raw);
    if (parsed === null) {
      // Format / checksum failed. Generic 401, no hint about which
      // part: the prefix may be valid but the body+checksum failed,
      // or the kind/env may be off.
      throw error(401, { message: "Authentication failed" } as App.Error);
    }

    if (parsed.kind === "acct") {
      if (!allow.has("acct_key")) {
        // Wrong key TYPE for this endpoint. Hint the caller because
        // this is a genuine UX issue (people pasting collector keys
        // into Ansible vars and account keys into agent configs).
        throw error(401, {
          message:
            "This endpoint expects a collector key (gmk_cru_*), " +
            "not an account API key (gmk_acct_*). Check your config.",
        } as App.Error);
      }
      const principal = await lookupAcctKey(parsed);
      if (principal === null) {
        throw error(401, { message: "Authentication failed" } as App.Error);
      }
      return principal;
    }

    if (parsed.kind === "cru") {
      if (!allow.has("cru_key")) {
        throw error(401, {
          message:
            "This endpoint expects an account API key (gmk_acct_*), " +
            "not a collector key (gmk_cru_*). Collector keys are scoped " +
            "to telemetry ingestion only.",
        } as App.Error);
      }
      const principal = await lookupCruKey(parsed);
      if (principal === null) {
        throw error(401, { message: "Authentication failed" } as App.Error);
      }
      return principal;
    }
  }

  // Nothing matched.
  throw error(401, { message: "Authentication required" } as App.Error);
}

// The legacy `requireScope(principal, scope)` helper was removed in
// unify-auth Spec D PR-1 (2026-05-16). It checked the principal's
// `scopes: string[]` field (always `["servers:manage"]` in v1) against
// a requested scope string. Every callsite already had a paired
// `requireScopeLevel(principal, "<read|write|admin>")` call running on
// the same handler — the hierarchical-scope check from Phase 4
// supersedes the boolean v1 scope. Use `requireScopeLevel` from
// `./plan.ts` instead. The underlying `account_api_keys.scopes`
// column is dropped by migration 020 in PR-2.
