// scope: read
// POST/GET /api/v1/servers
//
// Refactored in PR #3 of the API keys workstream to:
//   - Accept session, and new acct_key auth
//   - Use the new requireAuth + pickAllowedFields + writeAudit primitives
//   - Apply per-IP, per-key, per-account, and per-endpoint rate limits
//   - Support Idempotency-Key header on POST (Stripe-style)
//   - Accept hostname + tags fields on POST (in addition to name)
//
// Backwards compatibility:
//   - Web UI POSTs `{ name }` and gets back the same response shape it
//     used to. New `hostname` field is optional, defaults to name.
//   - The collector key returned is still the legacy `col_*` format.
//     PR #6 cuts over to gmk_cru_live_*.
//   - The api_key_hash is still bcrypt. Rehash to HMAC happens in PR #6.

import { json } from "@sveltejs/kit";
import { effectiveServerLimit } from "$lib/server/self-hosted";
import { ingestUrl } from "$lib/server/ingest-url";

import type { RequestHandler } from "./$types";
import crypto from "node:crypto";
import { query, withTransaction } from "@glassmkr/db/pg";
import { lockServerRowTx } from "$lib/server/services/server-admin-actions";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";
import { requireAuth } from "$lib/server/auth/require";
import { requireProTierForAcctKey, requireScopeLevel } from "$lib/server/auth/plan";
import { pickAllowedFields } from "$lib/server/auth/allowlist";
import { HOST_PROFILE_IDS } from "$lib/server/alerts/host-profiles";
import { writeAudit } from "$lib/server/auth/audit";
import { generateCollectorKey, hashKey, lastFour } from "$lib/server/auth/keys";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_KEY,
  TIER_PER_ACCOUNT,
  TIER_SERVERS_CREATE,
} from "$lib/server/auth/rate-limit";
import {
  checkIdempotency,
  recordIdempotency,
  inFlightResponse,
} from "$lib/server/auth/idempotency";
import type { Principal } from "$lib/server/auth/principal";
import { listServersForCustomer } from "$lib/server/services/fleet-read";

function generateId(prefix: string, bytes: number): string {
  return prefix + crypto.randomBytes(bytes).toString("hex");
}

// Validate an RFC 1035 hostname. Accepts dot-separated labels of 1-63
// chars, total <= 253. Hostnames are stored as opaque labels and never
// resolved server-side (spec threat A7 / SSRF).
const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function validateHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > 253) return null;
  if (!HOSTNAME_REGEX.test(value)) return null;
  return value;
}

function validateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > 100) return null;
  return value;
}

function validateTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 20) return null;
  for (const t of value) {
    if (typeof t !== "string" || t.length < 1 || t.length > 50) return null;
  }
  return value as string[];
}

// Stable machine identity for fleet auto-onboard (migration 033). The agent
// sends a DMI product_uuid (UUID, has hyphens) or /etc/machine-id (32 hex),
// so accept a conservative opaque-id charset. Stored, never resolved.
const MACHINE_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

function validateMachineId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!MACHINE_ID_REGEX.test(value)) return null;
  return value;
}

// ============================================================================
// GET /api/v1/servers
// ============================================================================
//
// Lists all servers for the authenticated principal's customer. Both
// session and acct_key principals see the same data; the BOLA constraint
// is principal.customer_id.
//
// Query params (additive, backwards-compatible with the unparametrised UI call):
//   limit  : 1-100, default 100 (UI loads everything)
//   cursor : opaque pagination cursor (created_at_ms encoded as base36)
//   tag    : filter by tag (repeatable)
//
// The response shape is unchanged for clients that don't pass any
// query params.

export const GET: RequestHandler = async (event) => {
  // Pre-auth IP debit (P1.2): a failed auth attempt below also costs
  // a token, so brute-force probing burns through the per-IP bucket.
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
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
      resource_type: "server",
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Pro-tier gate for programmatic callers (acct_key).
  // Dashboard sessions on any plan can list their own servers; the
  // programmatic API is a Pro feature. Codex 2026-05-12 P2: pre-fix the
  // GET only checked scope, so a Pro→Free downgrade left acct_keys
  // (and forge_* tokens) reading server metadata.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: GET requires `read`.
  try {
    requireScopeLevel(principal, "read");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  try {
    const customerId = principal.customer_id;

    // Pagination + filtering. Defaults preserve the existing
    // unparametrised behaviour: 100 rows, all servers, ordered DESC.
    const url = new URL(event.request.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = clampInt(limitRaw, 1, 100, 100);
    const cursor = url.searchParams.get("cursor");
    const cursorTs = decodeCursor(cursor);
    const tagFilter = url.searchParams.getAll("tag");

    const result = await listServersForCustomer({
      customerId,
      limit,
      createdBefore: cursorTs === null ? null : new Date(cursorTs),
      tags: tagFilter,
    });
    const nextCursor = result.nextCreatedAt
      ? encodeCursor(result.nextCreatedAt.getTime())
      : null;

    void writeAudit({
      event,
      principal,
      action: "list",
      result: "success",
      status_code: 200,
      resource_type: "server",
      metadata: { count: result.servers.length, has_more: result.hasMore },
    });

    return json({
      servers: result.servers,
      next_cursor: nextCursor,
    });
  } catch (err: any) {
    console.error("List servers error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "error",
      status_code: 500,
      resource_type: "server",
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to list servers" }, { status: 500 });
  }
};

// ============================================================================
// POST /api/v1/servers
// ============================================================================
//
// Body (mass-assignment defended via pickAllowedFields):
//   - hostname (optional, RFC 1035, defaults to name when name is set)
//   - name     (optional, 1-100 chars; when absent, a placeholder is
//               assigned that gets hidden in the UI once the agent's
//               first snapshot populates the real hostname; the UI
//               renders `hostname || name` everywhere so once
//               hostname is set, name is dead data anyway. Kept
//               settable for API consumers that still want a stable
//               label across snapshots.)
//   - tags     (optional, array of strings, <= 20 items)
//
// Idempotency:
//   - Idempotency-Key header (1-255 printable ASCII) is honoured
//   - 24h Redis-cached replay
//
// Rate limits applied (in order; first failure wins):
//   - per-IP, per-key, per-account, per-endpoint (100/hr/account)
//
// Audit log: one row per call regardless of outcome.

export const POST: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "create",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
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
      action: "create",
      result: "auth_failed",
      status_code: 401,
      resource_type: "server",
    });
    throw err;
  }

  // Pro-tier gate for acct_key callers. Dashboard sessions (Free or
  // Pro) can keep using "+ Add Server" up to the 3-server quota; the
  // quota check below is the Free-tier ceiling. acct_key creation
  // requires Pro because programmatic server management is a paid
  // feature.
  try {
    requireProTierForAcctKey(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "forbidden",
      status_code: 402,
      resource_type: "server",
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: POST requires `write`.
  try {
    requireScopeLevel(principal, "write");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "forbidden",
      status_code: 403,
      resource_type: "server",
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT, TIER_SERVERS_CREATE],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "rate_limited",
      status_code: 429,
      resource_type: "server",
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // Idempotency check
  const idem = await checkIdempotency({
    event,
    principal,
    scope: "POST /api/v1/servers",
  });
  if (idem.kind === "replay") {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: idem.cached.status >= 400 ? "invalid" : "success",
      status_code: idem.cached.status,
      resource_type: "server",
      metadata: { idempotency_replay: true },
    });
    return new Response(JSON.stringify(idem.cached.body), {
      status: idem.cached.status,
      headers: { "Content-Type": "application/json", "Idempotency-Replayed": "true" },
    });
  }
  if (idem.kind === "in_flight") {
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "invalid",
      status_code: 409,
      resource_type: "server",
      metadata: { reason: "idempotency_in_flight" },
    });
    return inFlightResponse();
  }

  try {
    const rawBody = await event.request.json().catch(() => ({}));
    const fields = pickAllowedFields(rawBody, ["hostname", "name", "tags", "profile", "machine_id"] as const);

    // name is optional (2026-05-22): when the caller omits it, assign a
    // placeholder that gets hidden in the UI once the agent's first
    // snapshot populates `hostname`. The UI renders `hostname || name`
    // everywhere; once hostname is set (60s after install), name is
    // effectively dead data. Keeping it settable for API consumers
    // that want a stable label across snapshots.
    //
    // If the caller passes `name` explicitly, validate it. If absent
    // or empty-string, fall through to the placeholder.
    let name = validateName(fields.name);
    const namePlaceholder = `pending (no snapshot yet)`;
    if (name === null) {
      // Distinguish "absent" (use placeholder) from "present but
      // invalid" (reject as before). validateName returns null for
      // both, so re-check the raw field shape.
      const fieldPresent = fields.name !== undefined && fields.name !== null && fields.name !== "";
      if (fieldPresent) {
        // The caller tried to set a name but it failed validation.
        // Fall through to the explicit null-check below which returns 400.
      } else {
        name = namePlaceholder;
      }
    }
    const hostname = fields.hostname !== undefined
      ? validateHostname(fields.hostname)
      : (name !== null && name !== namePlaceholder ? validateHostname(name) ?? name : null);
    const tags = fields.tags !== undefined ? validateTags(fields.tags) : [];
    // Host-type profile (migration 031): absent -> NULL (General, no
    // suppression); otherwise it must be a known id from host-profiles.ts.
    // Mirrors the validation on PATCH /servers/:id so create and update
    // accept exactly the same set.
    const profile = fields.profile !== undefined ? fields.profile : null;

    // P1.6: cache deterministic error responses too, so retries with
    // the same Idempotency-Key see the same outcome (spec contract).
    const cacheError = (status: number, body: unknown): void => {
      if (idem.kind === "fresh") {
        void recordIdempotency({
          principal,
          scope: "POST /api/v1/servers",
          key: idem.key,
          response: { status, body },
        });
      }
    };

    if (name === null) {
      // Only reachable when the caller passed `name` explicitly and it
      // failed validation (length 1-100). Absent name was filled with
      // the placeholder above.
      const body = { error: "validation_failed", message: "name, if provided, must be 1-100 chars" };
      void writeAudit({ event, principal, action: "create", result: "invalid", status_code: 400, resource_type: "server", metadata: { reason: "name" } });
      cacheError(400, body);
      return json(body, { status: 400 });
    }
    if (fields.hostname !== undefined && hostname === null) {
      const body = { error: "validation_failed", message: "hostname must be a valid RFC 1035 hostname (1-253 chars)" };
      void writeAudit({ event, principal, action: "create", result: "invalid", status_code: 400, resource_type: "server", metadata: { reason: "hostname" } });
      cacheError(400, body);
      return json(body, { status: 400 });
    }
    if (fields.tags !== undefined && tags === null) {
      const body = { error: "validation_failed", message: "tags must be an array of <=20 strings, each 1-50 chars" };
      void writeAudit({ event, principal, action: "create", result: "invalid", status_code: 400, resource_type: "server", metadata: { reason: "tags" } });
      cacheError(400, body);
      return json(body, { status: 400 });
    }
    if (profile !== null && (typeof profile !== "string" || !HOST_PROFILE_IDS.includes(profile))) {
      const body = { error: "validation_failed", message: `profile must be null or one of: ${HOST_PROFILE_IDS.join(", ")}` };
      void writeAudit({ event, principal, action: "create", result: "invalid", status_code: 400, resource_type: "server", metadata: { reason: "profile" } });
      cacheError(400, body);
      return json(body, { status: 400 });
    }
    const machineId = fields.machine_id !== undefined ? validateMachineId(fields.machine_id) : null;
    if (fields.machine_id !== undefined && machineId === null) {
      const body = { error: "validation_failed", message: "machine_id must be 1-128 chars of [A-Za-z0-9._:-]" };
      void writeAudit({ event, principal, action: "create", result: "invalid", status_code: 400, resource_type: "server", metadata: { reason: "machine_id" } });
      cacheError(400, body);
      return json(body, { status: 400 });
    }

    const customerId = principal.customer_id;

    // Fleet auto-onboard (migration 033): when the caller supplies a stable
    // machine_id, a re-provision of the SAME physical host maps back to its
    // existing server row instead of creating a duplicate that burns quota.
    // This is the durable idempotency mechanism - the Idempotency-Key header
    // is only a 24h Redis window; machine_id dedup is permanent and does not
    // depend on Redis being up.
    if (machineId !== null) {
      const existing = await query(
        `SELECT id, status FROM servers WHERE customer_id = $1 AND machine_id = $2 LIMIT 1`,
        [customerId, machineId],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0] as { id: string; status: string };
        if (row.status === "suspended") {
          const body = {
            error: "server_suspended",
            message: "This machine maps to a suspended server. Resolve billing to reactivate it before re-enrolling.",
          };
          void writeAudit({ event, principal, action: "reenroll", result: "forbidden", status_code: 402, resource_type: "server", resource_id: row.id, metadata: { reason: "suspended" } });
          cacheError(402, body);
          return json(body, { status: 402 });
        }
        if (row.status !== "active") {
          // Only 'active' may re-enroll. This branch used to special-case
          // 'suspended' and then re-enroll EVERYTHING else, so a machine-id
          // mapping to a trashed (status='deleted') server rotated the dead
          // row's keys and returned 200 with a key ingest would reject
          // (Codex 2026-08-29 #6, static half).
          const body = {
            error: "server_deleted",
            message: "This machine maps to a server in the trash. Restore it from the dashboard (or permanently remove it) before re-enrolling.",
          };
          void writeAudit({ event, principal, action: "reenroll", result: "forbidden", status_code: 409, resource_type: "server", resource_id: row.id, metadata: { reason: row.status } });
          cacheError(409, body);
          return json(body, { status: 409 });
        }
        // Active row -> re-enroll: rotate the collector key in place and hand
        // back the new one. No new row, so the node quota is untouched. The
        // old key stops working immediately (safe: it is the same machine
        // re-registering, typically after a re-image that wiped its config).
        const reKey = generateCollectorKey("live");
        const reHash = hashKey(reKey.raw);
        const reOutcome = await withTransaction<"ok" | string>(async (tx) => {
          // Parent-row lock first, matching every other collector-key writer.
          // See lockServerRowTx for why the ordering is load-bearing.
          await lockServerRowTx(tx, customerId, row.id);
          // Re-read status UNDER the lock. The checks above ran before this
          // transaction, so a concurrent delete or suspension landing in
          // between would otherwise have its keys revoked and a fresh key
          // minted against a row ingest rejects (Codex 2026-08-29 #6).
          const cur = await tx.query(
            `SELECT status FROM servers WHERE id = $1 AND customer_id = $2`,
            [row.id, customerId],
          );
          const st = (cur.rows[0] as { status?: string } | undefined)?.status ?? "missing";
          if (st !== "active") return st;
          await tx.query(
            `UPDATE account_api_keys SET revoked_at = NOW() WHERE server_id = $1 AND revoked_at IS NULL`,
            [row.id],
          );
          await tx.query(
            `INSERT INTO account_api_keys
              (customer_id, name, prefix, last_4, key_hash, server_id, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [customerId, row.id, reKey.prefix, lastFour(reKey), reHash, row.id, principal.kind === "acct_key" ? null : principal.customer_id],
          );
          await tx.query(`UPDATE servers SET api_key_hash = NULL WHERE id = $1 AND customer_id = $2`, [row.id, customerId]);
          return "ok";
        });
        if (reOutcome !== "ok") {
          const body = reOutcome === "suspended"
            ? { error: "server_suspended", message: "This machine maps to a suspended server. Resolve billing to reactivate it before re-enrolling." }
            : { error: "server_deleted", message: "This machine maps to a server that was just deleted. Restore it from the dashboard (or permanently remove it) before re-enrolling." };
          const status = reOutcome === "suspended" ? 402 : 409;
          void writeAudit({ event, principal, action: "reenroll", result: "forbidden", status_code: status, resource_type: "server", resource_id: row.id, metadata: { reason: reOutcome, raced: true } });
          cacheError(status, body);
          return json(body, { status });
        }
        const reBody = {
          success: true,
          reenrolled: true,
          server: { id: row.id, machine_id: machineId, api_key: reKey.raw, collector_key: reKey.raw },
          ingest_url: ingestUrl(),
          message: "This machine was already registered; its collector key has been rotated. Save the new key: the previous one is now invalid.",
        };
        if (idem.kind === "fresh") {
          void recordIdempotency({ principal, scope: "POST /api/v1/servers", key: idem.key, response: { status: 200, body: reBody } });
        }
        void writeAudit({ event, principal, action: "reenroll", result: "success", status_code: 200, resource_type: "server", resource_id: row.id, metadata: { machine_id: machineId, key_rotated: true } });
        return json(reBody, { status: 200 });
      }
    }

    const serverId = generateId("srv_", 8);
    // PR #6 cutover: issue gmk_cru_live_* keys with HMAC+pepper hash
    // stored in account_api_keys, joined to servers via server_id. The
    // legacy servers.api_key_hash column stays NULL for new rows; old
    // col_* keys still work for existing rows until each operator
    // rotates via /rotate-key.
    const collectorKey = generateCollectorKey("live");
    const collectorKeyHash = hashKey(collectorKey.raw);

    // G4 (launch hardening, 2026-08-24): the node-cap check runs INSIDE the
    // insert transaction under the per-customer advisory lock, mirroring the
    // service-layer sites hardened on 2026-07-21 (#3). This REST path had
    // the same TOCTOU: plan and count were read in separate unwrapped
    // queries, so two concurrent enrolls could both observe capacity. At
    // the cap the refusal is hard and clean: nothing is inserted, no key is
    // issued, the error states the cap and points at self-hosting.
    const quota = await withTransaction<{ exceeded: boolean; serverLimit: number }>(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [customerId]);
      const planResult = await tx.query(
        `SELECT plan_server_limit FROM customers WHERE id = $1`,
        [customerId],
      );
      const serverLimit = effectiveServerLimit(planResult.rows[0]?.plan_server_limit as number | undefined);
      const countResult = await tx.query(
        `SELECT COUNT(*) FROM servers WHERE customer_id = $1 AND status = 'active'`,
        [customerId],
      );
      if (parseInt(countResult.rows[0].count, 10) >= serverLimit) {
        return { exceeded: true, serverLimit };
      }
      await tx.query(
        `INSERT INTO servers (id, customer_id, name, hostname, api_key_hash, tags, profile, machine_id)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
        [serverId, customerId, name, hostname, tags ?? [], profile, machineId],
      );
      // The legacy `scopes` jsonb column was dropped by migration 020
      // (unify-auth Spec D). Crucible keys are server-bound and have
      // no account-level scope, so they never carried meaningful data
      // here — historically wrote `[]`.
      await tx.query(
        `INSERT INTO account_api_keys
          (customer_id, name, prefix, last_4, key_hash,
           server_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          customerId,
          name,
          collectorKey.prefix,
          lastFour(collectorKey),
          collectorKeyHash,
          serverId,
          principal.kind === "acct_key" ? null : principal.customer_id,
        ],
      );
      return { exceeded: false, serverLimit };
    });

    if (quota.exceeded) {
      const body = {
        error: "quota_exceeded",
          // A cap is a dead end unless the message says where the road
          // continues. Self-hosting has no node limit and is the honest answer
          // for a fleet larger than the hosted cap, so the refusal names it
          // rather than leaving the reader to assume they have to pay.
          message:
            `This account is at its ${quota.serverLimit}-node cap; the server was not added. ` +
            `Remove a server first, or self-host Glassmkr, which has no node limit: https://glassmkr.com/docs/self-hosting`,
      };
      void writeAudit({ event, principal, action: "create", result: "forbidden", status_code: 403, resource_type: "server", metadata: { reason: "quota", limit: quota.serverLimit } });
      cacheError(403, body);
      return json(body, { status: 403 });
    }

    // Adjust Stripe subscription quantity if this customer is on Pro.
    await syncSubscriptionQuantitySafe(customerId);

    const responseBody = {
      success: true,
      server: {
        id: serverId,
        name,
        hostname,
        machine_id: machineId,
        tags: tags ?? [],
        // Field name remains `api_key` for backwards compatibility with
        // the dashboard "Add Server" flow and any operator scripts that
        // parse the JSON response. The value is now a gmk_cru_live_*
        // string instead of col_<32 hex>.
        api_key: collectorKey.raw,
        // Alias under the canonical name. rotate-key returns the key as
        // `collector_key`; expose it here too so clients can parse either
        // field consistently across create + rotate (fleet report #4).
        collector_key: collectorKey.raw,
      },
      ingest_url: ingestUrl(),
      message:
        "Save your collector key. It will not be shown again. Set it as " +
        "the `dashboard.api_key` field in /etc/glassmkr/crucible.yaml on " +
        "your agent host (legacy installs: /etc/glassmkr/collector.yaml; the agent reads either).",
    };

    if (idem.kind === "fresh") {
      void recordIdempotency({
        principal,
        scope: "POST /api/v1/servers",
        key: idem.key,
        response: { status: 201, body: responseBody },
      });
    }

    void writeAudit({
      event,
      principal,
      action: "create",
      result: "success",
      status_code: 201,
      resource_type: "server",
      resource_id: serverId,
      metadata: {
        hostname,
        tags: tags ?? [],
        idempotency_key: idem.kind === "fresh" ? idem.key : null,
      },
    });

    return json(responseBody, { status: 201 });
  } catch (err: any) {
    // Concurrent enroll of the same machine_id: the create-path INSERT lost
    // the race to servers_customer_machine_id_uniq (migration 033). This is
    // effectively impossible for a single host (it does not POST twice at
    // once), so return 409 and let the client retry - the retry finds the
    // now-existing row and takes the idempotent re-enroll branch above.
    if (err?.code === "23505") {
      void writeAudit({
        event,
        principal,
        action: "create",
        result: "invalid",
        status_code: 409,
        resource_type: "server",
        metadata: { reason: "machine_id_conflict" },
      });
      return json(
        { error: "conflict", message: "This machine is being enrolled concurrently. Retry the request." },
        { status: 409 },
      );
    }
    console.error("Server register error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "create",
      result: "error",
      status_code: 500,
      resource_type: "server",
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to register server" }, { status: 500 });
  }
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function encodeCursor(tsMs: number): string {
  return tsMs.toString(36);
}

function decodeCursor(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseInt(raw, 36);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
