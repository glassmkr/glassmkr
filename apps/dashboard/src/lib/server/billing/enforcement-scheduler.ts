// In-process cron for the billing-enforcement cycle. Mirrors the
// pattern set by watchdog-scheduler.ts and trend-warnings/scheduler.ts:
// node-cron, started exactly once per process from hooks.server.ts.
//
// Cadence: hourly. Rationale: the spec accepts up to one hour of delay
// between billing-period-end and the disable-action; the cron's
// lookback window in `findEnforcementCandidates` is 65 minutes (5 min
// overlap with the prior cycle in case a process restart skipped one).

import cron from "node-cron";
import { runEnforcementCycle } from "./enforcement";

let started = false;

export function startBillingEnforcement(): void {
  if (started) return;
  started = true;

  // Top of every hour.
  cron.schedule("0 * * * *", async () => {
    try {
      await runEnforcementCycle();
    } catch (err) {
      console.error("[billing-enforcement] cycle error:", (err as Error).message);
    }
  });

  console.log("[billing-enforcement] scheduled (hourly at :00)");
}
