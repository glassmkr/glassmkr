// The resource version a confirm token is bound to.
//
// WHY THIS IS NOT read off the object getServerForCustomer returns
//
// That function builds a hand-picked projection for callers who display a
// server. It does not carry `api_key_hash`, and there is no `deleted_at`
// column at all. Computing a version from its result produced a digest over
// `status` and `name` with two undefined fields alongside, so a prior key
// rotation did not invalidate a pending confirmation. The binding read as
// present and was not doing its job.
//
// Widening that projection would have been the smaller diff and the wrong one:
// it would put the collector key hash on an object handed to MCP result
// builders and to everything else that reads a server. So the version is
// computed here, by a query that selects only what the version needs, and only
// the opaque digest leaves this module.
//
// `active_key_id` rather than the hash: the live collector key lives in
// `account_api_keys`, and rotation sets `servers.api_key_hash` to NULL, so the
// column on `servers` is not the thing that changes. The id of the non-revoked
// key row changes on every rotation and discloses nothing.
import { query, type TxClient } from "@glassmkr/db/pg";
import { resourceVersion } from "./confirm.js";

// One column list, so a locked read and an unlocked read can never disagree
// about what the version covers.
const VERSION_COLUMNS = `
  s.status,
  s.name,
  (SELECT k.id::text
     FROM account_api_keys k
    WHERE k.server_id = s.id AND k.revoked_at IS NULL
    ORDER BY k.created_at DESC
    LIMIT 1) AS active_key_id`;

const byId = (lock: boolean) => `
  SELECT ${VERSION_COLUMNS}
    FROM servers s
   WHERE s.id = $1 AND s.customer_id = $2${lock ? "\n   FOR UPDATE OF s" : ""}`;

const byName = (lock: boolean) => `
  SELECT ${VERSION_COLUMNS}
    FROM servers s
   WHERE s.customer_id = $1 AND s.name = $2
   LIMIT 1${lock ? "\n   FOR UPDATE OF s" : ""}`;

export type TargetVersion = {
  /** The opaque version digest. Never contains key material. */
  version: string;
  /** Present only when the target exists. */
  name: string | null;
  status: string | null;
  exists: boolean;
};

function toVersion(row: Record<string, unknown> | undefined): TargetVersion {
  if (!row) return { version: resourceVersion(null), name: null, status: null, exists: false };
  return {
    version: resourceVersion(row),
    name: String(row.name ?? ""),
    status: String(row.status ?? ""),
    exists: true,
  };
}

/**
 * Read a version WITHOUT locking, for the prepare path.
 *
 * prepare is a preview and declares readOnlyHint, so it must not take a row
 * lock that a concurrent commit would wait on. A version read here can be stale
 * by the time it is used, which is fine and is the whole design: if the target
 * moved on, the commit's locked read produces a different version and the token
 * is refused.
 */
export async function readServerVersion(customerId: string, serverId: string): Promise<TargetVersion> {
  const res = await query(byId(false), [serverId, customerId]);
  return toVersion(res.rows[0] as Record<string, unknown> | undefined);
}

/** As above, addressed by name, for preparing an enrollment. */
export async function readServerVersionByName(customerId: string, name: string): Promise<TargetVersion> {
  const res = await query(byName(false), [customerId, name]);
  return toVersion(res.rows[0] as Record<string, unknown> | undefined);
}

/**
 * Lock the server row and return its current version, for a commit path.
 *
 * The lock is the point. The caller compares this version against the token,
 * spends the token, and mutates, all in one transaction, so nothing can change
 * the row between the check and the write.
 */
export async function lockServerVersion(
  tx: TxClient,
  customerId: string,
  serverId: string,
): Promise<TargetVersion> {
  const res = await tx.query(byId(true), [serverId, customerId]);
  return toVersion(res.rows[0] as Record<string, unknown> | undefined);
}

/**
 * Lock any server already holding this name, for a commit that enrolls one.
 *
 * Absence is itself the version: prepare signs "absent", so a server appearing
 * under this name before the commit changes the version and the token is
 * refused rather than a second server being enrolled under a name the operator
 * believed was free. Soft-deleted servers count, because a trashed server still
 * holds its name.
 */
export async function lockServerVersionByName(
  tx: TxClient,
  customerId: string,
  name: string,
): Promise<TargetVersion> {
  const res = await tx.query(byName(true), [customerId, name]);
  return toVersion(res.rows[0] as Record<string, unknown> | undefined);
}
