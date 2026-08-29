// Daily cron for billing-enforcement T-3 and T-1 reminder emails.
// Mirrors enforcement-scheduler.ts: node-cron, started once per process
// from hooks.server.ts. Cadence: 06:00 UTC daily.

import cron from "node-cron";
import { runReminderCycle } from "./email-reminders";

let started = false;

export function startEmailReminders(): void {
  if (started) return;
  started = true;

  // 06:00 UTC daily.
  cron.schedule("0 6 * * *", async () => {
    try {
      await runReminderCycle();
    } catch (err) {
      console.error("[email-reminders] cycle error:", (err as Error).message);
    }
  });

  console.log("[email-reminders] scheduled (daily at 06:00 UTC)");
}
