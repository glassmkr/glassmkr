// One-shot scheduler for the endoflife.date OS-lifecycle sync. Started once
// per process from hooks.server.ts. Loads the last-good dataset from Postgres
// immediately (so the os_end_of_life rule has data at once), kicks off one
// fetch to freshen it, then refreshes daily at 07:00 UTC.
//
// UTC slot map (avoid collisions): 00/06/12/18 trend-warnings, 05 key-expiry,
// */2min watchdog. 07:00 is free. OS lifecycle dates change on the order of
// days, so once a day is ample.
//
// Set ENDOFLIFE_SYNC_DISABLED=1 to skip the network entirely (e.g. an air-
// gapped deploy); the rule then relies on whatever is already persisted.

import cron from "node-cron";
import { runEndoflifeSync, loadLifecycleFromDb } from "./job";

let started = false;

export function startEndoflifeSync(): void {
  if (started) return;
  started = true;

  // Warm the cache from Postgres first; the rule can evaluate against
  // last-good data before the network fetch returns (or if it fails).
  loadLifecycleFromDb()
    .then((n) => console.log(`[endoflife] loaded ${n} lifecycle rows from Postgres`))
    .catch((err) => console.error("[endoflife] initial DB load failed:", (err as Error).message));

  if (process.env.ENDOFLIFE_SYNC_DISABLED === "1") {
    console.log("[endoflife] sync disabled (ENDOFLIFE_SYNC_DISABLED=1); using persisted data only");
    return;
  }

  // Freshen on startup (do not wait for the first cron tick).
  runEndoflifeSync()
    .then((r) => console.log(`[endoflife] startup sync: ${r.fetched} rows across ${r.products} products${r.failed.length ? `, failed: ${r.failed.join(",")}` : ""}`))
    .catch((err) => console.error("[endoflife] startup sync error:", (err as Error).message));

  // Daily at 07:00 UTC.
  cron.schedule("0 7 * * *", async () => {
    try {
      const r = await runEndoflifeSync();
      console.log(`[endoflife] daily sync: ${r.fetched} rows across ${r.products} products${r.failed.length ? `, failed: ${r.failed.join(",")}` : ""}`);
    } catch (err) {
      console.error("[endoflife] daily sync error:", (err as Error).message);
    }
  });

  console.log("[endoflife] scheduled (daily at 07:00 UTC)");
}
