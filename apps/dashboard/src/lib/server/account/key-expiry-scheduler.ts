// Daily cron starter for Phase 4 account-key expiry processing.
// Mirrors the billing schedulers (node-cron, started once per process
// from hooks.server.ts). 05:00 UTC daily — avoids the existing
// 02 / 03 / 04 / 06 slots.

import cron from "node-cron";
import { runKeyExpiryCycle } from "./key-expiry";

let started = false;

export function startKeyExpiry(): void {
  if (started) return;
  started = true;

  cron.schedule("0 5 * * *", async () => {
    try {
      const result = await runKeyExpiryCycle();
      console.log(
        `[key-expiry] cycle done t7=${result.t7} t1=${result.t1} expired=${result.expired} grace_reaped=${result.grace_reaped}`,
      );
    } catch (err) {
      console.error("[key-expiry] cycle error:", (err as Error).message);
    }
  });

  console.log("[key-expiry] scheduled (daily at 05:00 UTC)");
}
