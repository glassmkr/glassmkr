// One-shot scheduler for the trend warnings batch job. Started once per
// process from hooks.server.ts. Runs every 6 hours at 00/06/12/18 UTC.
//
// Spec: 07-trend-warnings-spec-v2.md, Scheduled Job.

import cron from "node-cron";
import { runTrendWarningsBatch } from "./job";

let started = false;

export function startTrendWarnings(): void {
  if (started) return;
  started = true;

  // Every 6 hours on the hour (00:00, 06:00, 12:00, 18:00 UTC).
  cron.schedule("0 */6 * * *", async () => {
    try {
      await runTrendWarningsBatch();
    } catch (err) {
      console.error("[trend-warnings] batch error:", (err as Error).message);
    }
  });

  console.log("[trend-warnings] scheduled (every 6 hours at 00/06/12/18 UTC)");
}
