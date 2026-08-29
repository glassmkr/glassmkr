// One-shot scheduler for the server_unreachable watchdog. Started exactly once
// per process from hooks.server.ts. node-cron runs in-process on a timer wheel,
// no external scheduler needed.

import cron from "node-cron";
import { runWatchdogCycle } from "./watchdog";

let started = false;

export function startWatchdog(): void {
  if (started) return;
  started = true;

  // Every 2 minutes.
  cron.schedule("*/2 * * * *", async () => {
    try {
      await runWatchdogCycle();
    } catch (err) {
      console.error("[watchdog] cycle error:", (err as Error).message);
    }
  });

  console.log("[watchdog] scheduled (every 2 minutes)");
}
