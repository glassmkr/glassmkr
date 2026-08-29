// Shared admin/destructive server mutations, tenant-scoped by customer. One
// implementation behind the REST routes and the MCP admin tools. Every function
// scopes by customer_id (tenant isolation) and returns null when the target is not
// owned, rather than throwing, so callers map the outcome to their own responses.
import crypto from "node:crypto";
import { effectiveServerLimit } from "../self-hosted";
import { query, withTransaction, type TxClient } from "@glassmkr/db/pg";
import { generateCollectorKey, hashKey, lastFour } from "$lib/server/auth/keys";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";

function newServerId(): string {
  return `srv_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Take the server row's lock. EVERY collector-key mutation must call this
 * FIRST, before touching account_api_keys.
 *
 * WHY THIS EXISTS
 *
 * A server's collector key lives in account_api_keys, a child table, but the
 * thing callers reason about ("this server's current key") spans both tables.
 * The MCP confirm path locks the server row and then reads the key row to build
 * a resource version. The REST rotate route and the machine-id re-enrollment
 * path did the reverse: revoke and insert key rows first, and touched the
 * parent row only at the end.
 *
 * Two transactions taking the same two locks in opposite orders is a deadlock,
 * and until one blocks, the MCP side can read a key row that another
 * transaction is midway through replacing, so its version check passes against
 * state that is already gone. Ordering every writer through this one lock, on
 * the parent row, removes both.
 *
 * Returns false when the server is not owned, so callers keep their existing
 * null-means-not-yours contract.
 */
export async function lockServerRowTx(
  tx: TxClient,
  customerId: string,
  serverId: string,
): Promise<boolean> {
  const res = await tx.query(
    `SELECT id FROM servers WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
    [serverId, customerId],
  );
  return res.rows.length > 0;
}

/**
 * Soft-delete: move an owned server to status='deleted' (restorable), rather than
 * the REST route's irreversible hard DELETE. Returns the row or null if not owned
 * or not currently ACTIVE. Only 'active' servers are eligible on purpose: a
 * 'suspended' server (no_card_on_file / subscription_cancelled / etc.) must NOT be
 * launder-able through trash back to active, bypassing the billing restore gate
 * (Codex 2026-07-21 #1). Syncs the billed node count (a deleted server drops out of
 * the active count, same as a hard delete).
 */
export async function softDeleteServerForCustomer(
  customerId: string,
  serverId: string,
): Promise<{ id: string; name: string } | null> {
  const row = await withTransaction((tx) => softDeleteServerTx(tx, customerId, serverId));
  if (row) await syncSubscriptionQuantitySafe(customerId);
  return row;
}

/**
 * The soft delete itself, inside a caller's transaction.
 *
 * Exists so a caller that has already locked the server row and checked a
 * confirmation token can perform the write in the SAME transaction. The MCP
 * commit path used to read state, spend the token and mutate as three separate
 * statements, which left a window where the target could change after the token
 * had been accepted.
 *
 * The billing sync is deliberately NOT here: it calls the payment provider, and
 * an external call inside a transaction holds a row lock for the length of a
 * network round trip. Callers run it after the commit.
 */
export async function softDeleteServerTx(
  tx: TxClient,
  customerId: string,
  serverId: string,
): Promise<{ id: string; name: string } | null> {
  const result = await tx.query(
    `UPDATE servers SET status = 'deleted'
      WHERE id = $1 AND customer_id = $2 AND status = 'active'
    RETURNING id, name`,
    [serverId, customerId],
  );
  return (result.rows[0] as { id: string; name: string }) ?? null;
}

export type RestoreDeletedResult =
  | { status: "not_found" }
  | { status: "quota_exceeded"; limit: number }
  | { status: "restored"; id: string; name: string };

/**
 * Restore a soft-deleted server (status='deleted' -> 'active'). Distinct from the
 * billing restore (/servers/[id]/restore handles no_card_on_file suspensions with
 * card checks); this only un-deletes a user-deleted server. Enforces the plan node
 * quota under a per-customer advisory lock (Codex 2026-07-21 #2: restoring
 * re-activates a node, and the Pro-only billing-enforcement job does not repair
 * a Free account that restores past its limit). Returns not_found for a server
 * that is not an owned deleted one.
 */
export async function restoreDeletedServerForCustomer(
  customerId: string,
  serverId: string,
): Promise<RestoreDeletedResult> {
  const outcome = await withTransaction<RestoreDeletedResult>(async (tx) => {
    // Serialize per-customer node-count mutations so concurrent restores/enrolls
    // cannot both pass the quota check and both activate.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [customerId]);
    const owned = await tx.query(
      "SELECT name FROM servers WHERE id = $1 AND customer_id = $2 AND status = 'deleted'",
      [serverId, customerId],
    );
    if (owned.rows.length === 0) return { status: "not_found" };
    const planRes = await tx.query("SELECT plan_server_limit FROM customers WHERE id = $1", [customerId]);
    const limit = effectiveServerLimit(planRes.rows[0]?.plan_server_limit as number | undefined);
    const countRes = await tx.query(
      "SELECT COUNT(*) FROM servers WHERE customer_id = $1 AND status = 'active'",
      [customerId],
    );
    if (parseInt(countRes.rows[0].count, 10) >= limit) return { status: "quota_exceeded", limit };
    const upd = await tx.query(
      `UPDATE servers SET status = 'active'
        WHERE id = $1 AND customer_id = $2 AND status = 'deleted'
      RETURNING id, name`,
      [serverId, customerId],
    );
    if (upd.rows.length === 0) return { status: "not_found" };
    const row = upd.rows[0] as { id: string; name: string };
    return { status: "restored", id: row.id, name: row.name };
  });
  if (outcome.status === "restored") await syncSubscriptionQuantitySafe(customerId);
  return outcome;
}

/**
 * List a customer's soft-deleted servers (for the trash UI). Bounded.
 */
export async function listDeletedServersForCustomer(
  customerId: string,
): Promise<Array<{ id: string; name: string; hostname: string | null; last_seen_at: Date | null }>> {
  const result = await query(
    `SELECT id, name, hostname, last_seen_at FROM servers
      WHERE customer_id = $1 AND status = 'deleted'
      ORDER BY name ASC LIMIT 200`,
    [customerId],
  );
  return result.rows as Array<{ id: string; name: string; hostname: string | null; last_seen_at: Date | null }>;
}

/**
 * Rotate an owned server's collector key. Mirrors the REST rotate-key transaction:
 * revoke existing cru key rows, insert the new one, clear any legacy
 * servers.api_key_hash. Returns the one-time key + old/new last4, or null if not
 * owned. createdByUserId is null for programmatic/MCP callers.
 */
export async function rotateCollectorKeyForCustomer(
  customerId: string,
  serverId: string,
  createdByUserId: string | null,
): Promise<{ collectorKey: string; oldLast4: string | null; newLast4: string } | null> {
  return withTransaction((tx) => rotateCollectorKeyTx(tx, customerId, serverId, createdByUserId));
}

/**
 * The rotation itself, inside a caller's transaction. See softDeleteServerTx
 * for why the tx-aware variant exists.
 *
 * The ownership check is inside the transaction too. It used to run on the pool
 * before the transaction opened, so a server could stop being owned between the
 * check and the write.
 */
export async function rotateCollectorKeyTx(
  tx: TxClient,
  customerId: string,
  serverId: string,
  createdByUserId: string | null,
): Promise<{ collectorKey: string; oldLast4: string | null; newLast4: string } | null> {
  // The parent-row lock comes first: see lockServerRowTx.
  if (!(await lockServerRowTx(tx, customerId, serverId))) return null;

  const newKey = generateCollectorKey("live");
  const newKeyHash = hashKey(newKey.raw);
  let oldLast4: string | null = null;
  const oldRows = await tx.query(
    `SELECT last_4 FROM account_api_keys WHERE server_id = $1 AND revoked_at IS NULL`,
    [serverId],
  );
  if (oldRows.rows.length > 0) {
    oldLast4 = (oldRows.rows[0] as { last_4: string }).last_4;
    await tx.query(
      `UPDATE account_api_keys SET revoked_at = NOW() WHERE server_id = $1 AND revoked_at IS NULL`,
      [serverId],
    );
  }
  await tx.query(
    `INSERT INTO account_api_keys
      (customer_id, name, prefix, last_4, key_hash, server_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [customerId, serverId, newKey.prefix, lastFour(newKey), newKeyHash, serverId, createdByUserId],
  );
  await tx.query(
    `UPDATE servers SET api_key_hash = NULL WHERE id = $1 AND customer_id = $2`,
    [serverId, customerId],
  );
  return { collectorKey: newKey.raw, oldLast4, newLast4: lastFour(newKey) };
}

export type CreateServerResult =
  | { status: "quota_exceeded"; limit: number }
  | { status: "created"; serverId: string; collectorKey: string };

/**
 * Create a server + mint its one-time collector key, enforcing the plan node quota,
 * then sync billing. Used by the MCP enroll tool. NOTE: this MIRRORS the create-tail
 * of POST /api/v1/servers (quota + txn INSERT + key mint + subscription sync); that
 * route keeps its own copy plus HTTP-only Idempotency-Key + machine-id re-enroll
 * handling. Unifying the two create paths onto this service is a follow-up (flagged
 * for review). createdByUserId is null for programmatic/MCP callers.
 */
export async function createServerForCustomer(
  customerId: string,
  input: {
    name: string;
    hostname?: string | null;
    tags?: string[];
    profile?: string | null;
    machineId?: string | null;
    createdByUserId: string | null;
  },
): Promise<CreateServerResult> {
  const outcome = await withTransaction<CreateServerResult>((tx) => createServerTx(tx, customerId, input));
  if (outcome.status === "created") await syncSubscriptionQuantitySafe(customerId);
  return outcome;
}

/** The enrollment itself, inside a caller's transaction. See softDeleteServerTx. */
export async function createServerTx(
  tx: TxClient,
  customerId: string,
  input: {
    name: string;
    hostname?: string | null;
    tags?: string[];
    profile?: string | null;
    machineId?: string | null;
    createdByUserId: string | null;
  },
): Promise<CreateServerResult> {
  const serverId = newServerId();
  const collectorKey = generateCollectorKey("live");
  const collectorKeyHash = hashKey(collectorKey.raw);
  {
    // Quota check + insert under a per-customer advisory lock so two concurrent
    // enrolls cannot both observe capacity and both insert past the limit (Codex
    // 2026-07-21 #3: previously the count was read outside the transaction).
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [customerId]);
    const planRes = await tx.query("SELECT plan_server_limit FROM customers WHERE id = $1", [customerId]);
    const limit = effectiveServerLimit(planRes.rows[0]?.plan_server_limit as number | undefined);
    const countRes = await tx.query(
      "SELECT COUNT(*) FROM servers WHERE customer_id = $1 AND status = 'active'",
      [customerId],
    );
    if (parseInt(countRes.rows[0].count, 10) >= limit) return { status: "quota_exceeded", limit };
    await tx.query(
      `INSERT INTO servers (id, customer_id, name, hostname, api_key_hash, tags, profile, machine_id)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
      [serverId, customerId, input.name, input.hostname ?? input.name, input.tags ?? [], input.profile ?? null, input.machineId ?? null],
    );
    await tx.query(
      `INSERT INTO account_api_keys
        (customer_id, name, prefix, last_4, key_hash, server_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [customerId, input.name, collectorKey.prefix, lastFour(collectorKey), collectorKeyHash, serverId, input.createdByUserId],
    );
    return { status: "created", serverId, collectorKey: collectorKey.raw };
  }
}
