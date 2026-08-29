// scope: read
// POST /api/v1/account/keys  - create a new account API key
// GET  /api/v1/account/keys  - list the customer's keys (no plaintext)
//
// Auth: session ONLY. Acct keys cannot mint other
// acct keys in v1 (spec Part 4: "API-key-creating-API-key is not
// allowed in v1; account API keys are created only via the web UI
// initially"). The legacy `forge_*` token path is allowed because it
// represents the same human at the keyboard.
//
// POST: requires recent re-authentication via /verify-password (5 min
// window). Returns the plaintext exactly once with a save-it-now
// warning. Hash + last_4 stored; plaintext never persisted.
//
// Rate limits: per-IP, per-account. POST also gets the per-endpoint
// "rotate-key" sub-limit because creation of a new key is roughly the
// same risk profile as rotating one.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import {
  requireProTierForAcctKey,
  requireScopeLevel,
} from "$lib/server/auth/plan";
import { pickAllowedFields } from "$lib/server/auth/allowlist";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_ACCOUNT,
  TIER_KEY_ROTATE,
} from "$lib/server/auth/rate-limit";
import { requireRecentReAuth } from "$lib/server/auth/reauth";
import { generateAccountKey, hashKey, lastFour } from "$lib/server/auth/keys";
import type { Principal } from "$lib/server/auth/principal";
import { CAPABILITIES, isCapability } from "$lib/server/auth/capabilities";

// The legacy v1 `scopes` jsonb array (`["servers:manage"]`) was dropped
// from the schema by migration 020 (unify-auth Spec D). The hierarchical
// `scope` text column below is the sole scope authority going forward.

// Phase 4: 3-level hierarchical scope. Created with the key, immutable
// (rotation can change scope, but a given key never mutates mid-life).
const ALLOWED_SCOPE_LEVELS = new Set(["read", "write", "admin"] as const);
const DEFAULT_SCOPE_LEVEL = "write";

// Phase 4: optional expiry cap. Five years is the spec ceiling.
const MAX_EXPIRY_MS = 5 * 365 * 24 * 60 * 60 * 1000;

function validateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 100) return null;
  return trimmed;
}

function validateScopeLevel(value: unknown): "read" | "write" | "admin" | "invalid" {
  if (value === undefined || value === null) return DEFAULT_SCOPE_LEVEL;
  if (typeof value !== "string") return "invalid";
  if (value === "read" || value === "write" || value === "admin") return value;
  return "invalid";
}

function validateExpiresAt(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "invalid";
  if (d.getTime() <= Date.now()) return "invalid";
  if (d.getTime() - Date.now() > MAX_EXPIRY_MS) return "invalid";
  return d;
}

// ============================================================================
// POST /api/v1/account/keys
// ============================================================================

export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "create",
      result: "rate_limited",
      status_code: 429,
      resource_type: "api_key",
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, {
      allow: ["session"],
    });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "create",
      result: "auth_failed",
      status_code: 401,
      resource_type: "api_key",
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_ACCOUNT, TIER_KEY_ROTATE],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "rate_limited",
      status_code: 429,
      resource_type: "api_key",
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Pro-tier gate moved below — it's now conditional on requested
  // scope per CC_UNIFY_API_AUTH_2026-05-15.md (unify-auth Spec B):
  // Free tier can create read-only keys; Pro tier required for
  // write or admin scope. The check fires after scope validation
  // so we know which gate applies.

  // Step-up: must have re-authenticated within the last 5 minutes.
  try {
    await requireRecentReAuth(principal.customer_id);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "forbidden",
      status_code: err?.status ?? 403,
      resource_type: "api_key",
      metadata: { reason: "reauth_required" },
    });
    throw err;
  }

  try {
    const rawBody = await event.request.json().catch(() => ({}));
    const fields = pickAllowedFields(rawBody, [
      "name",
      "scope",
      "capabilities",
      "expires_at",
    ] as const);

    const name = validateName(fields.name);
    if (name === null) {
      void writeAudit({
        event,
        principal,
        action: "create",
        result: "invalid",
        status_code: 400,
        resource_type: "api_key",
        metadata: { reason: "name" },
      });
      return json(
        { error: "validation_failed", message: "name is required (1-100 chars)" },
        { status: 400 },
      );
    }

    // Phase 4 hierarchical scope (immutable per key). The legacy `scopes`
    // jsonb array input (`["servers:manage"]`) was removed in Spec D — the
    // `scope` text field below is now the only scope authority.
    const scopeLevel = validateScopeLevel(fields.scope);
    if (scopeLevel === "invalid") {
      void writeAudit({
        event,
        principal,
        action: "create",
        result: "invalid",
        status_code: 400,
        resource_type: "api_key",
        metadata: { reason: "scope" },
      });
      return json(
        {
          error: "validation_failed",
          message: `scope must be one of: ${[...ALLOWED_SCOPE_LEVELS].join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Free-tier scope restriction (unify-auth Spec B / Free-tier scope
    // restriction decision). Free customers can create read-only keys;
    // write and admin require Pro. The dashboard hides the scope
    // selector for Free accounts (Spec C), but the endpoint must
    // reject directly-crafted requests too.
    // 2026-06-21 re-gating: the programmatic API is Free, so any plan may mint
    // write/admin keys. Per-key scope still bounds what the key can do, and the
    // node-count cap + rate limits still apply.

    const expires = validateExpiresAt(fields.expires_at);
    if (expires === "invalid") {
      void writeAudit({
        event,
        principal,
        action: "create",
        result: "invalid",
        status_code: 400,
        resource_type: "api_key",
        metadata: { reason: "expires_at" },
      });
      return json(
        {
          error: "validation_failed",
          message: "expires_at must be a future ISO 8601 timestamp within 5 years",
        },
        { status: 400 },
      );
    }

    // Generate the key + storage hash.
    const key = generateAccountKey("live");
    const keyHash = hashKey(key.raw);

    // Opt-in capabilities. Absent means none, which is what every key created
    // before migration 041 holds. servers:purge is deliberately NOT implied by
    // admin scope: permanently destroying data is a different kind of
    // authority, not a higher tier of the same one.
    const rawCaps = fields.capabilities;
    if (rawCaps !== undefined && !Array.isArray(rawCaps)) {
      return json(
        { error: "invalid_capabilities", message: "capabilities must be an array of strings." },
        { status: 400 },
      );
    }
    const requested = Array.isArray(rawCaps) ? rawCaps : [];
    const unknownCaps = requested.filter((c) => !isCapability(c));
    if (unknownCaps.length) {
      return json(
        {
          error: "invalid_capabilities",
          message: `Unknown capability: ${unknownCaps.map(String).join(", ")}. Supported: ${CAPABILITIES.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    const capabilities = requested.filter(isCapability);
    // Mirrors the database CHECK constraint from migration 041. A read key
    // holding a destructive capability would be incoherent.
    if (capabilities.length > 0 && scopeLevel === "read") {
      return json(
        {
          error: "invalid_capabilities",
          message: "A read-scoped key cannot hold capabilities. Use write or admin scope.",
        },
        { status: 400 },
      );
    }

    const insert = await query(
      `INSERT INTO account_api_keys
        (customer_id, name, prefix, last_4, key_hash, scope, capabilities, expires_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        principal.customer_id,
        name,
        key.prefix,
        lastFour(key),
        keyHash,
        scopeLevel,
        JSON.stringify(capabilities),
        expires,
        // For session principals, the user who created the key is the
        // same as the customer (one-user-per-customer model). Recorded
        // separately for forensic correlation when multi-user lands.
        principal.customer_id,
      ],
    );

    const row = insert.rows[0];

    void writeAudit({
      event,
      principal,
      action: "create",
      result: "success",
      status_code: 201,
      resource_type: "api_key",
      resource_id: row.id,
      metadata: {
        name,
        scope: scopeLevel,
        expires_at: expires?.toISOString() ?? null,
        last_4: lastFour(key),
      },
    });

    return json(
      {
        success: true,
        key: {
          id: row.id,
          name,
          prefix: key.prefix,
          last_4: lastFour(key),
          scope: scopeLevel,
          created_at: row.created_at,
          expires_at: expires?.toISOString() ?? null,
        },
        api_key: key.raw,
        message:
          "Save this API key. The plaintext will not be shown again. " +
          "Store it in a secret manager and use it as: " +
          "Authorization: Bearer " + key.raw,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("Create account key error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "error",
      status_code: 500,
      resource_type: "api_key",
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to create API key" }, { status: 500 });
  }
};

// ============================================================================
// GET /api/v1/account/keys
// ============================================================================
//
// Lists active (non-revoked, non-expired) keys for the authenticated
// customer. Plaintext is NEVER returned; only the metadata that lets
// the customer recognise the key in the UI (prefix + last_4 + name +
// last_used_at).
//
// Acct keys CAN list other acct keys (spec is silent; we err on
// permissive since the data is non-sensitive metadata).

export const GET: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "api_key",
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, {
      allow: ["session", "acct_key"],
    });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "list",
      result: "auth_failed",
      status_code: 401,
      resource_type: "api_key",
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "api_key",
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Pro-tier gate for programmatic callers. Real dashboard sessions
  // can still list their (revoked / expiring) keys after a Pro→Free
  // downgrade for cleanup purposes; programmatic callers cannot. Codex
  // 2026-05-12 P2.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 402,
      resource_type: "api_key",
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: listing keys is `read` (metadata only,
  // no plaintext). Sessions bypass per requireScopeLevel's convention.
  try {
    requireScopeLevel(principal, "read");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 403,
      resource_type: "api_key",
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  try {
    const includeRevoked =
      event.url.searchParams.get("include_revoked") === "true";

    // server_id IS NULL filters out cru collector rows. Account-key
    // endpoints must never list/manipulate collector keys (that's the
    // /servers/{id}/rotate-key path); enforced by spec Part 2's
    // key-separation invariant.
    const rows = await query(
      `SELECT id, name, prefix, last_4, scope, created_at, last_used_at,
              expires_at, revoked_at, replaces_key_id, replaced_by_key_id,
              grace_period_ends_at
         FROM account_api_keys
        WHERE customer_id = $1
          AND server_id IS NULL
          ${includeRevoked ? "" : "AND revoked_at IS NULL"}
        ORDER BY created_at DESC
        LIMIT 200`,
      [principal.customer_id],
    );

    void writeAudit({
      event,
      principal,
      action: "list",
      result: "success",
      status_code: 200,
      resource_type: "api_key",
      metadata: { count: rows.rows.length, include_revoked: includeRevoked },
    });

    return json({
      keys: rows.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        last_4: r.last_4,
        scope: r.scope ?? "admin",
        created_at: r.created_at,
        last_used_at: r.last_used_at,
        expires_at: r.expires_at,
        revoked_at: r.revoked_at,
        replaces_key_id: r.replaces_key_id,
        replaced_by_key_id: r.replaced_by_key_id,
        grace_period_ends_at: r.grace_period_ends_at,
      })),
    });
  } catch (err: any) {
    console.error("List account keys error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "error",
      status_code: 500,
      resource_type: "api_key",
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to list API keys" }, { status: 500 });
  }
};
