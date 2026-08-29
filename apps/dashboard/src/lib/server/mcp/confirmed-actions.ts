// Destructive MCP actions, as single transactions.
//
// THE RACE THIS EXISTS TO CLOSE
//
// The commit path used to do three things in sequence, each on its own
// connection: read the server, spend the confirmation token, then mutate. Every
// gap between those steps is a window in which the target can change. The
// version binding on the token is what makes a changed target refuse the
// commit, and reading the version outside the transaction that performs the
// write means the version can be true when it is checked and false when it is
// used. A token could be accepted against a server that had already been
// renamed, trashed, or had its key rotated a moment earlier.
//
// So each function here opens one transaction and, inside it:
//
//   1. locks the target row and reads its CURRENT version
//   2. spends the confirmation token against that version
//   3. checks the echoed name against the LOCKED row, not an earlier read
//   4. performs the mutation
//
// If anything fails the transaction rolls back, which also un-spends the token:
// a commit that did not happen must not consume the operator's one
// authorisation. If it succeeds, the token row and the mutation commit together
// and the token can never be spent twice.
//
// Billing sync runs AFTER the commit, deliberately. It calls the payment
// provider, and an external round trip inside a transaction holds the row lock
// for its duration.
import { withTransaction, type TxClient } from "@glassmkr/db/pg";
import { consumeConfirmTokenOn, type ConfirmOutcome, enrollTarget } from "./confirm.js";
import { lockServerVersion, lockServerVersionByName } from "./resource-version.js";
import {
  createServerTx,
  rotateCollectorKeyTx,
  softDeleteServerTx,
  type CreateServerResult,
} from "$lib/server/services/server-admin-actions.js";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";

/** Why a confirmed action did not proceed. Callers map these to MCP errors. */
export type ConfirmedFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_used" }
  | { ok: false; reason: "invalid_token" }
  | { ok: false; reason: "name_mismatch" }
  | { ok: false; reason: "name_taken" }
  | { ok: false; reason: "quota_exceeded"; limit: number };

export type ConfirmedResult<T> = ({ ok: true } & T) | ConfirmedFailure;

/**
 * Thrown to abandon a transaction with a reason rather than an error.
 *
 * Returning `{ ok: false }` from inside withTransaction COMMITS: the callback
 * finished normally, so Postgres commits, and the confirm-token row inserted a
 * few statements earlier is committed with it. The token is then spent for an
 * action that never happened, which is the opposite of the stated contract and
 * leaves the operator holding a dead token.
 *
 * Only a throw rolls back. So every refusal after the token has been inserted
 * throws this, and the wrapper below turns it back into a return value. The
 * type system cannot enforce that, so `runConfirmed` is the only way these
 * actions open a transaction.
 */
class ConfirmedAbort extends Error {
  constructor(readonly failure: ConfirmedFailure) {
    super(`confirmed action refused: ${failure.reason}`);
    this.name = "ConfirmedAbort";
  }
}

/** Refuse, and roll the transaction back. */
function refuse(failure: ConfirmedFailure): never {
  throw new ConfirmedAbort(failure);
}

/**
 * Run a confirmed action in one transaction, converting an abort back into a
 * returned failure. A genuine error still propagates.
 */
async function runConfirmed<T>(
  fn: (tx: TxClient) => Promise<({ ok: true } & T)>,
): Promise<ConfirmedResult<T>> {
  try {
    return await withTransaction(fn);
  } catch (err) {
    if (err instanceof ConfirmedAbort) return err.failure;
    throw err;
  }
}

/**
 * Compare the echoed name to the row we hold the lock on.
 *
 * Trim and case-fold only. The echo exists to make the model restate the target,
 * not to be lenient about which target it means.
 */
function namesMatch(echoed: string, actual: string | null): boolean {
  return typeof actual === "string" && echoed.trim().toLowerCase() === actual.trim().toLowerCase();
}

function failureFor(outcome: ConfirmOutcome): ConfirmedFailure {
  return outcome === "already_used"
    ? { ok: false, reason: "already_used" }
    : { ok: false, reason: "invalid_token" };
}

/** Move an owned server to trash, atomically with the token check. */
export async function confirmedSoftDelete(args: {
  customerId: string;
  serverId: string;
  token: string;
  confirmName: string;
  nowMs?: number;
}): Promise<ConfirmedResult<{ id: string; name: string }>> {
  const result = await runConfirmed<{ id: string; name: string }>(async (tx) => {
    const target = await lockServerVersion(tx, args.customerId, args.serverId);
    if (!target.exists) refuse({ ok: false, reason: "not_found" });

    const outcome = await consumeConfirmTokenOn(
      (sql, params) => tx.query(sql, params),
      args.token, args.customerId, "delete_server", args.serverId, target.version, args.nowMs,
    );
    if (outcome !== "ok") refuse(failureFor(outcome));

    if (!namesMatch(args.confirmName, target.name)) refuse({ ok: false, reason: "name_mismatch" });

    const row = await softDeleteServerTx(tx, args.customerId, args.serverId);
    // Not owned, or not active: a suspended or already-trashed server is not
    // eligible, and the version check cannot express that on its own.
    if (!row) refuse({ ok: false, reason: "not_found" });
    return { ok: true, id: row.id, name: row.name };
  });

  if (result.ok) await syncSubscriptionQuantitySafe(args.customerId);
  return result;
}

/** Rotate an owned server's collector key, atomically with the token check. */
export async function confirmedRotateKey(args: {
  customerId: string;
  serverId: string;
  token: string;
  confirmName: string;
  createdByUserId?: string | null;
  nowMs?: number;
}): Promise<ConfirmedResult<{ collectorKey: string; oldLast4: string | null; newLast4: string }>> {
  return runConfirmed(async (tx) => {
    const target = await lockServerVersion(tx, args.customerId, args.serverId);
    if (!target.exists) refuse({ ok: false, reason: "not_found" });

    const outcome = await consumeConfirmTokenOn(
      (sql, params) => tx.query(sql, params),
      args.token, args.customerId, "rotate_key", args.serverId, target.version, args.nowMs,
    );
    if (outcome !== "ok") refuse(failureFor(outcome));

    if (!namesMatch(args.confirmName, target.name)) refuse({ ok: false, reason: "name_mismatch" });

    const rotated = await rotateCollectorKeyTx(
      tx, args.customerId, args.serverId, args.createdByUserId ?? null,
    );
    if (!rotated) refuse({ ok: false, reason: "not_found" });
    return { ok: true, ...rotated };
  });
}

/** Enroll a new server, atomically with the token check. */
export async function confirmedEnroll(args: {
  customerId: string;
  name: string;
  hostname?: string | null;
  tags?: string[];
  token: string;
  confirmName: string;
  createdByUserId?: string | null;
  nowMs?: number;
}): Promise<ConfirmedResult<{ serverId: string; collectorKey: string }>> {
  const result = await runConfirmed<{ serverId: string; collectorKey: string }>(async (tx) => {
    // The advisory lock comes FIRST and is the same one createServerTx takes,
    // so the ordering is identical on every path into this table and two
    // concurrent enrollments cannot deadlock against each other.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [args.customerId]);

    const target = await lockServerVersionByName(tx, args.customerId, args.name);

    // ABSENCE IS THE POINT, and it has to be asserted here rather than inferred
    // from the version matching. The version of an existing server is a
    // perfectly stable value: prepare would sign it, the commit would read the
    // same one, the token would verify, and a SECOND server would be inserted
    // under a name the operator believed was free. Nothing about "the version
    // did not change" means "nothing is there". prepare refuses an existing
    // name outright; this is the same check reasserted under the lock, where
    // it is the one that actually decides.
    if (target.exists) refuse({ ok: false, reason: "name_taken" });

    // The token binds the FULL mutation (name, hostname, tags), not the name
    // alone: prepare showed the operator exactly these values, and any
    // difference here is an unpreviewed change riding an approved token
    // (Codex 2026-08-29 #8).
    const outcome = await consumeConfirmTokenOn(
      (sql, params) => tx.query(sql, params),
      args.token, args.customerId, "enroll_server",
      enrollTarget(args.name, args.hostname, args.tags), target.version, args.nowMs,
    );
    if (outcome !== "ok") refuse(failureFor(outcome));

    if (args.confirmName.trim().toLowerCase() !== args.name.trim().toLowerCase()) {
      refuse({ ok: false, reason: "name_mismatch" });
    }

    const created: CreateServerResult = await createServerTx(tx, args.customerId, {
      name: args.name,
      hostname: args.hostname ?? null,
      tags: args.tags,
      createdByUserId: args.createdByUserId ?? null,
    });
    if (created.status === "quota_exceeded") {
      refuse({ ok: false, reason: "quota_exceeded", limit: created.limit });
    }
    return { ok: true, serverId: created.serverId, collectorKey: created.collectorKey };
  });

  if (result.ok) await syncSubscriptionQuantitySafe(args.customerId);
  return result;
}
