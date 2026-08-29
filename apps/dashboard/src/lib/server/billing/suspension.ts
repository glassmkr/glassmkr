// Shared helper for the two billing-driven server-suspension paths:
//
//   1. customer.subscription.deleted webhook (full downgrade to Free)
//   2. enforcement cron (Pro + no card on file at billing-period-end)
//
// Both produce the same "which N stay active" decision: keep the
// `freeQuota` OLDEST servers (`ORDER BY created_at ASC`) in the active
// pool, suspend everything past that. Sharing the helper means the
// ordering is enforced at one source — the regression test in
// __tests__/suspension.test.ts locks the invariant for both call sites.
//
// Idempotency: re-suspending an already-suspended row preserves the
// original `suspended_at` / `suspended_reason` via COALESCE. Calling
// twice in a row is a no-op for already-suspended rows.

import { query } from "@glassmkr/db/pg";

export type SuspendReason = "subscription_cancelled" | "no_card_on_file";

export interface SuspensionResult {
  /** Server IDs that were transitioned to suspended in this call. May
   *  be empty if the customer had ≤ freeQuota active servers, or if
   *  every server was already suspended. */
  suspended_ids: string[];
  /** Server IDs that remain active (the "kept" set, oldest first). */
  kept_ids: string[];
  /** Reason recorded on the suspended rows. */
  reason: SuspendReason;
}

/**
 * Suspend the servers above the free quota for a given customer.
 *
 * Always sorts by `created_at ASC` — oldest stays. Both billing-driven
 * suspension paths share this helper specifically so the ordering
 * cannot drift between them.
 */
export async function suspendExcessServers(
  customerId: string,
  freeQuota: number,
  reason: SuspendReason,
): Promise<SuspensionResult> {
  const activeRes = await query(
    `SELECT id FROM servers
      WHERE customer_id = $1 AND status = 'active'
      ORDER BY created_at ASC`,
    [customerId],
  );
  const allActive = (activeRes.rows as Array<{ id: string }>).map((r) => r.id);

  if (allActive.length <= freeQuota) {
    return { suspended_ids: [], kept_ids: allActive, reason };
  }

  const kept = allActive.slice(0, freeQuota);
  const toSuspend = allActive.slice(freeQuota);

  // BOLA defence: customer_id constraint on the UPDATE in addition to
  // the id list. The id list is already derived from the prior SELECT
  // which is itself customer-scoped, so this is belt-and-suspenders;
  // it closes any toctou window between the two queries.
  await query(
    `UPDATE servers
        SET status = 'suspended',
            suspended_at = COALESCE(suspended_at, NOW()),
            suspended_reason = COALESCE(suspended_reason, $2)
      WHERE id = ANY($1::text[]) AND customer_id = $3`,
    [toSuspend, reason, customerId],
  );

  return { suspended_ids: toSuspend, kept_ids: kept, reason };
}
