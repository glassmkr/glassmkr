// Daily cron worker for Phase 4 key-expiry semantics.
//
// Runs once per process per day at 05:00 UTC (slot picked to avoid
// the existing 02 / 03 / 04 / 06 crons). Each cycle:
//
//   1. Sweep keys with `expires_at IN (now, now+7d]` and emit T-7
//      reminder emails. Notification idempotency: T-7 fires only
//      when the email-sent watermark is older than the current
//      T-7 window. We keep watermark state in-memory per process
//      and refresh by querying which keys' T-7 fall in today's
//      sweep window; that means at most one email per cron run
//      per key, which matches the spec.
//   2. Same for T-1 (`expires_at IN (now, now+1d]`).
//   3. Revoke expired keys (`expires_at < now` and `revoked_at IS
//      NULL`); emit "key expired" email.
//   4. Revoke keys past their rotation-grace window
//      (`grace_period_ends_at < now` and `revoked_at IS NULL`).
//      No email — the customer initiated the rotation and already
//      knows.
//
// Each step is its own SQL query, idempotent: re-running on the
// same day at the same time is safe (a revoked key won't be
// revoked again; an expired-email recipient won't get a duplicate
// because the revoke is bundled with the email send in step 3, and
// only un-revoked rows enter the candidate set).

import { query } from "@glassmkr/db/pg";
import {
  sendKeyExpiringT7,
  sendKeyExpiringT1,
  sendKeyExpired,
  type KeyExpiryEmailContext,
} from "./email";

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  expires_at: Date;
  customer_id: string;
  email: string;
  customer_name: string | null;
}

function ctx(row: KeyRow): KeyExpiryEmailContext {
  const firstName = (row.customer_name ?? row.email.split("@")[0] ?? "there").split(" ")[0];
  return {
    email: row.email,
    firstName,
    keyName: row.name,
    prefix: row.prefix,
    scope: row.scope,
    expiresAt: row.expires_at,
  };
}

export async function runKeyExpiryCycle(): Promise<{
  t7: number;
  t1: number;
  expired: number;
  grace_reaped: number;
}> {
  let t7 = 0;
  let t1 = 0;
  let expired = 0;
  let grace_reaped = 0;

  // Each step is isolated in its own try/catch: a failure in one is logged
  // and does NOT abort the others. This is deliberate. A single bad step (a
  // `c.name` column reference; the column is `display_name`) used to throw on
  // the very first query and silently took down the grace reaper AND every
  // warning email for days. Isolation guarantees the later steps still run.

  // ---- T-7: expires in (6d, 7d] -------------------------------------
  // The half-open window picks each key up exactly once over the
  // course of normal daily runs, assuming the cron fires once per day.
  try {
    const t7Rows = await query(
      `SELECT k.id, k.name, k.prefix, k.scope, k.expires_at,
              c.id AS customer_id, c.email, c.display_name AS customer_name
         FROM account_api_keys k
         JOIN customers c ON c.id = k.customer_id
        WHERE k.server_id IS NULL
          AND k.revoked_at IS NULL
          AND k.expires_at > NOW() + INTERVAL '6 days'
          AND k.expires_at <= NOW() + INTERVAL '7 days'`,
    );
    for (const row of (t7Rows.rows as KeyRow[])) {
      if (await sendKeyExpiringT7(ctx(row))) t7++;
    }
  } catch (err) {
    console.error("[key-expiry] T-7 step failed:", (err as Error).message);
  }

  // ---- T-1: expires in (0, 1d] --------------------------------------
  try {
    const t1Rows = await query(
      `SELECT k.id, k.name, k.prefix, k.scope, k.expires_at,
              c.id AS customer_id, c.email, c.display_name AS customer_name
         FROM account_api_keys k
         JOIN customers c ON c.id = k.customer_id
        WHERE k.server_id IS NULL
          AND k.revoked_at IS NULL
          AND k.expires_at > NOW()
          AND k.expires_at <= NOW() + INTERVAL '1 day'`,
    );
    for (const row of (t1Rows.rows as KeyRow[])) {
      if (await sendKeyExpiringT1(ctx(row))) t1++;
    }
  } catch (err) {
    console.error("[key-expiry] T-1 step failed:", (err as Error).message);
  }

  // ---- Expired: revoke + notify -------------------------------------
  // RETURNING gives us the rows so we can email without a second SELECT.
  // The revoke is atomic per row; if the email send fails the row is
  // still revoked (correct behaviour: stop the key from working even
  // if the customer didn't hear about it; they'll see it in /settings).
  try {
    const expiredRows = await query(
      `WITH expired AS (
         UPDATE account_api_keys
            SET revoked_at = NOW()
          WHERE server_id IS NULL
            AND revoked_at IS NULL
            AND expires_at IS NOT NULL
            AND expires_at < NOW()
          RETURNING id, customer_id, name, prefix, scope, expires_at
       )
       SELECT e.id, e.name, e.prefix, e.scope, e.expires_at,
              c.id AS customer_id, c.email, c.display_name AS customer_name
         FROM expired e
         JOIN customers c ON c.id = e.customer_id`,
    );
    for (const row of (expiredRows.rows as KeyRow[])) {
      if (await sendKeyExpired(ctx(row))) expired++;
    }
  } catch (err) {
    console.error("[key-expiry] expired step failed:", (err as Error).message);
  }

  // ---- Rotation grace reaper (no email) -----------------------------
  // Customer initiated the rotation; the dashboard shows the countdown.
  try {
    const graceRes = await query(
      `UPDATE account_api_keys
          SET revoked_at = NOW()
        WHERE server_id IS NULL
          AND revoked_at IS NULL
          AND grace_period_ends_at IS NOT NULL
          AND grace_period_ends_at < NOW()`,
    );
    grace_reaped = graceRes.rowCount ?? 0;
  } catch (err) {
    console.error("[key-expiry] grace-reaper step failed:", (err as Error).message);
  }

  return { t7, t1, expired, grace_reaped };
}
