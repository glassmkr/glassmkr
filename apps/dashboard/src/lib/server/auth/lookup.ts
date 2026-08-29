// DB lookups for gmk_* keys.
//
// Called by the auth middleware (hooks.server.ts and the ingest
// authenticator) once a presented bearer token has been parsed and
// passed format/checksum validation in keys.ts.
//
// All queries go through the existing `query()` helper from @glassmkr/db/pg
// to share the connection pool with the rest of the app.

import { parseCapabilities } from "./capabilities.js";
import { query } from "@glassmkr/db/pg";
import { hashKey, type ParsedKey } from "./keys.js";
import type {
  AcctKeyPrincipal,
  CruKeyPrincipal,
} from "./principal.js";

// ---------------------------------------------------------------------------
// Account API keys (gmk_acct_*)
// ---------------------------------------------------------------------------

/**
 * Look up an account API key by its plaintext form. Verifies the row is
 * not revoked and not expired. Updates `last_used_at` asynchronously
 * (fire-and-forget) so the auth path doesn't block on a write.
 *
 * Returns null on any miss: row not found, revoked, expired. Caller
 * should respond with a generic 401 in all of those cases (no leak about
 * which condition failed).
 *
 * Defence-in-depth: the `prefix` column is checked against the parsed
 * prefix even after the HMAC lookup. SHA-256 collisions are vanishingly
 * unlikely but the check is cheap.
 */
export async function lookupAcctKey(parsed: ParsedKey): Promise<AcctKeyPrincipal | null> {
  if (parsed.kind !== "acct") return null;
  const keyHash = hashKey(parsed.raw);

  const res = await query(
    `SELECT k.id, k.customer_id, k.prefix, k.scope, k.capabilities, k.expires_at,
            k.revoked_at, k.grace_period_ends_at, c.plan
       FROM account_api_keys k
       JOIN customers c ON c.id = k.customer_id
      WHERE k.key_hash = $1`,
    [keyHash],
  );
  if (res.rows.length === 0) return null;

  const row = res.rows[0] as {
    id: string;
    customer_id: string;
    prefix: string;
    scope: string;
    capabilities: unknown;
    expires_at: Date | null;
    revoked_at: Date | null;
    grace_period_ends_at: Date | null;
    plan: string | null;
  };

  if (row.prefix !== parsed.prefix) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at !== null && row.expires_at <= new Date()) return null;
  // A rotated key's old credential carries grace_period_ends_at. Once that
  // passes it must stop authenticating immediately, not linger until the
  // daily reaper sets revoked_at. Rotation does not set expires_at, so the
  // check above does not cover this case.
  if (row.grace_period_ends_at !== null && row.grace_period_ends_at <= new Date()) return null;

  // Fire-and-forget last-used-at write. Errors here are non-fatal; the
  // auth result is unchanged. Batched / coalesced versions of this can
  // come later if it shows up in profiling.
  // bola-exempt: row.id came from a key_hash lookup; the HMAC match
  // IS the BOLA defence. No need for an additional customer_id
  // constraint on the metadata write.
  void query(
    `UPDATE account_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [row.id],
  ).catch((err) => {
    console.error("[auth] last_used_at update failed:", (err as Error).message);
  });

  // Hierarchical scope (Phase 4). Defaults to `admin` if the DB
  // somehow returns a value outside the constrained vocabulary (the
  // CHECK constraint should prevent this, but defence-in-depth).
  // The legacy `scopes` jsonb array was retired in unify-auth Spec D
  // PR-1; the column itself is dropped by migration 020 (PR-2).
  const scope: "read" | "write" | "admin" =
    row.scope === "read" || row.scope === "write" || row.scope === "admin"
      ? row.scope
      : "admin";

  return {
    kind: "acct_key",
    customer_id: row.customer_id,
    key_id: row.id,
    scope,
    // Opt-in and additive; NOT implied by scope. Anything unrecognised in the
    // column is dropped rather than trusted. See auth/capabilities.ts.
    capabilities: parseCapabilities(row.capabilities),
    plan: row.plan ?? "free",
  };
}

// ---------------------------------------------------------------------------
// Collector keys (gmk_cru_*)
// ---------------------------------------------------------------------------

/**
 * Look up a NEW-format collector key. Returns null on miss/revoked.
 *
 * The new collector keys live in account_api_keys with kind="cru" rolled
 * up via the prefix field. Each has a server_id stored in metadata
 * (until PR #5 adds a dedicated server_id column). For now we look them
 * up via the same key_hash path as acct keys; the prefix discrimination
 * happens in the route-level requireAuth.
 *
 * NOTE for PR #2: this function is implemented but not yet wired in. The
 * actual ingest endpoint still authenticates via the legacy `col_*`
 * path. PR #6 cuts over.
 */
export async function lookupCruKey(parsed: ParsedKey): Promise<CruKeyPrincipal | null> {
  if (parsed.kind !== "cru") return null;
  const keyHash = hashKey(parsed.raw);

  // For PR #2 we accept that the schema for cru keys hasn't fully
  // landed yet (account_api_keys is for both kinds; the server_id
  // backreference isn't a column yet). Look up by hash + prefix and
  // surface a stub principal. The ingest route will reject any
  // gmk_cru_* with a structured error until PR #6.
  //
  // Once PR #6 lands, this query joins to a `server_collector_keys`
  // table (or extends servers with cru_key_id) and returns the
  // server_id directly.
  const res = await query(
    `SELECT id, customer_id, prefix, expires_at, revoked_at, grace_period_ends_at
       FROM account_api_keys
      WHERE key_hash = $1`,
    [keyHash],
  );
  if (res.rows.length === 0) return null;

  const row = res.rows[0] as {
    id: string;
    customer_id: string;
    prefix: string;
    expires_at: Date | null;
    revoked_at: Date | null;
    grace_period_ends_at: Date | null;
  };

  if (row.prefix !== parsed.prefix) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at !== null && row.expires_at <= new Date()) return null;
  // Grace-ended keys are invalid even if not yet reaped (see lookupAcctKey).
  if (row.grace_period_ends_at !== null && row.grace_period_ends_at <= new Date()) return null;

  // Stub: the server_id binding lands in PR #6. Until then we return
  // a placeholder; the ingest route guards against this anyway.
  return {
    kind: "cru_key",
    server_id: "",
    customer_id: row.customer_id,
    key_id: row.id,
    is_legacy_format: false,
  };
}

// ---------------------------------------------------------------------------
// Legacy col_* lookup (preserved as a reference; the actual implementation
// stays in apps/dashboard/src/routes/api/v1/ingest/+server.ts:authenticateCollector
// until PR #6 unifies the path.)
// ---------------------------------------------------------------------------
// NOTE: not exported yet. Wiring lives in ingest/+server.ts; we don't
// want two divergent legacy-collector-key implementations.
