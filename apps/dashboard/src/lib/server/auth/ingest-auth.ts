// Collector ingest authentication. Extracted from
// `routes/api/v1/ingest/+server.ts` so the cache-revalidation behaviour
// can be unit-tested in isolation.
//
// Two formats coexist during the migration window:
//   - gmk_cru_<env>_<43 base62>_<4 checksum>: new format. HMAC+pepper
//     hash, indexed lookup against account_api_keys joined on server_id.
//   - col_<32 hex>: legacy. Bcrypt against servers.api_key_hash. Table
//     scan, bounded by the cache.
//
// IMPORTANT (P1.3 fix): a cache HIT does NOT bypass the revoked/active
// check. Every hit issues one cheap PK lookup that confirms the row is
// still valid. Without this, rotated/revoked keys would keep
// authenticating until the in-memory TTL expired (5 min), contradicting
// spec Part 13's immediate-invalidation contract.

import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { query } from "@glassmkr/db/pg";
import { isPlausibleApiKey } from "$lib/server/ingest/lifecycle";
import { parseKey, hashKey } from "$lib/server/auth/keys";

export interface CachedCollectorAuth {
  serverId: string;
  customerId: string;
  keyId: string | null; // gmk: account_api_keys.id; legacy: null
  cachedAt: number;
}

export interface AuthenticatedCollector {
  id: string;
  customerId: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

const keyCache = new Map<string, CachedCollectorAuth>();

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Test-only: clear the in-memory cache between cases. */
export function clearCollectorAuthCacheForTests(): void {
  keyCache.clear();
}

/** Test-only: inspect the cache. */
export function peekCollectorAuthCacheForTests(): ReadonlyMap<string, CachedCollectorAuth> {
  return keyCache;
}

async function revalidateCachedAuth(cached: CachedCollectorAuth): Promise<boolean> {
  if (cached.keyId !== null) {
    const r = await query(
      `SELECT 1
         FROM account_api_keys k
         JOIN servers s ON s.id = k.server_id
        WHERE k.id = $1
          AND k.revoked_at IS NULL
          AND (k.expires_at IS NULL OR k.expires_at > NOW())
          AND (k.grace_period_ends_at IS NULL OR k.grace_period_ends_at > NOW())
          AND s.status = 'active'
        LIMIT 1`,
      [cached.keyId],
    );
    return r.rows.length > 0;
  }
  // bola-exempt: ingest path. The cache fingerprint is itself the
  // ownership proof (we matched bcrypt against this server's hash on
  // cache populate); we now revalidate that the server still has an
  // active legacy hash. No customer_id available because ingest
  // doesn't carry session context.
  const r = await query(
    `SELECT 1 FROM servers
      WHERE id = $1 AND status = 'active' AND api_key_hash IS NOT NULL
      LIMIT 1`,
    [cached.serverId],
  );
  return r.rows.length > 0;
}

export async function authenticateCollector(
  authHeader: string | null,
): Promise<AuthenticatedCollector | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7).trim();
  if (!isPlausibleApiKey(apiKey)) return null;

  const fingerprint = sha256(apiKey);

  const cached = keyCache.get(fingerprint);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    if (await revalidateCachedAuth(cached)) {
      return { id: cached.serverId, customerId: cached.customerId };
    }
    keyCache.delete(fingerprint);
  }

  // Path A: new gmk_cru_* format.
  if (apiKey.startsWith("gmk_cru_")) {
    const parsed = parseKey(apiKey);
    if (parsed === null || parsed.kind !== "cru") return null;

    const keyHashed = hashKey(parsed.raw);
    const result = await query(
      `SELECT k.id AS key_id, k.server_id, k.prefix, k.expires_at, k.revoked_at,
              k.grace_period_ends_at, s.customer_id, s.status
         FROM account_api_keys k
         JOIN servers s ON s.id = k.server_id
        WHERE k.key_hash = $1
          AND k.server_id IS NOT NULL
        LIMIT 1`,
      [keyHashed],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (row.prefix !== parsed.prefix) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at !== null && row.expires_at <= new Date()) return null;
    // Grace-ended keys are invalid even if the reaper has not revoked them yet.
    if (row.grace_period_ends_at !== null && row.grace_period_ends_at <= new Date()) return null;
    if (row.status !== "active") return null;

    void query(
      `UPDATE account_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [row.key_id],
    ).catch((err) => console.error("[ingest] last_used_at update failed:", err.message));

    keyCache.set(fingerprint, {
      serverId: row.server_id,
      customerId: row.customer_id,
      keyId: row.key_id,
      cachedAt: Date.now(),
    });
    return { id: row.server_id, customerId: row.customer_id };
  }

  // Path B: legacy col_* (bcrypt scan).
  const result = await query(
    `SELECT id, customer_id, api_key_hash FROM servers
      WHERE status = 'active' AND api_key_hash IS NOT NULL`,
  );
  for (const row of result.rows) {
    const match = await bcrypt.compare(apiKey, row.api_key_hash);
    if (match) {
      keyCache.set(fingerprint, {
        serverId: row.id,
        customerId: row.customer_id,
        keyId: null,
        cachedAt: Date.now(),
      });
      return { id: row.id, customerId: row.customer_id };
    }
  }
  return null;
}
