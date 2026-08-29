// endoflife.date sync job.
//
// Fetches OS lifecycle data from the endoflife.date v1 API and upserts it into
// Postgres (os_lifecycle table), then refreshes the in-process cache the
// os_end_of_life rule reads. Runs on startup + a daily cron (scheduler.ts).
//
// Design (CC_CURRENCY_BUILD_DECISION_2026-07-15): server-side periodic sync,
// NOT a build-time snapshot, because the v1 API is self-described as Beta and
// the data changes continuously; syncing means one place to fix on drift. We
// upsert (never delete-all) so a product whose fetch fails keeps its last-good
// rows, and we load from Postgres on boot so the rule has data before the
// first successful fetch and survives an endoflife.date outage.
//
// Data from endoflife.date (https://endoflife.date), CC BY-SA. We persist only
// lifecycle dates (facts), not the descriptive prose.

import { query } from "@glassmkr/db/pg";
import { setLifecycleCache, type LifecycleRow } from "./cache.js";

const API_BASE = "https://endoflife.date/api/v1/products";
const FETCH_TIMEOUT_MS = 15_000;

// The in-scope distros (RESEARCH_CURRENCY_MONITORING_2026-07-15 §A.2).
export const TRACKED_PRODUCTS = [
  "ubuntu",
  "debian",
  "rhel",
  "rocky-linux",
  "almalinux",
  "centos",
  "centos-stream",
  "amazon-linux",
  "oracle-linux",
  "sles",
  "opensuse",
] as const;

// Accept only an ISO date string (YYYY-MM-DD); reject booleans/nulls/garbage.
// The v1 API uses a separate isEol/isEoes boolean and a *From date, so the
// date fields are date-or-null, but we coerce defensively against drift.
function coerceIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function releasesToRows(product: string, releases: unknown): LifecycleRow[] {
  if (!Array.isArray(releases)) return [];
  const rows: LifecycleRow[] = [];
  for (const r of releases) {
    if (!r || typeof r !== "object") continue;
    const rel = r as Record<string, unknown>;
    const cycle = typeof rel.name === "string" ? rel.name : null;
    if (!cycle) continue;
    rows.push({
      product,
      cycle,
      label: typeof rel.label === "string" ? rel.label : null,
      eol_from: coerceIsoDate(rel.eolFrom),
      eoes_from: coerceIsoDate(rel.eoesFrom),
      is_lts: rel.isLts === true,
    });
  }
  return rows;
}

async function fetchProduct(product: string): Promise<LifecycleRow[]> {
  const res = await fetch(`${API_BASE}/${product}/`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const result = (body?.result ?? body) as Record<string, unknown>;
  return releasesToRows(product, result?.releases);
}

async function upsertRows(rows: LifecycleRow[]): Promise<void> {
  for (const r of rows) {
    await query(
      `INSERT INTO os_lifecycle (product, cycle, label, eol_from, eoes_from, is_lts, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (product, cycle) DO UPDATE SET
         label = EXCLUDED.label,
         eol_from = EXCLUDED.eol_from,
         eoes_from = EXCLUDED.eoes_from,
         is_lts = EXCLUDED.is_lts,
         synced_at = now()`,
      [r.product, r.cycle, r.label, r.eol_from, r.eoes_from, r.is_lts],
    );
  }
}

/** Load the persisted dataset from Postgres into the in-memory cache. Called
 *  on startup so the rule has data before the first API fetch completes. */
export async function loadLifecycleFromDb(): Promise<number> {
  const res = await query(
    `SELECT product, cycle, label,
            to_char(eol_from, 'YYYY-MM-DD') AS eol_from,
            to_char(eoes_from, 'YYYY-MM-DD') AS eoes_from,
            is_lts
       FROM os_lifecycle`,
  );
  const rows = res.rows as LifecycleRow[];
  setLifecycleCache(rows);
  return rows.length;
}

/** Fetch every tracked product, upsert to Postgres, refresh the cache. A
 *  per-product fetch failure is logged and skipped (that product keeps its
 *  last-good rows); the whole run never throws. */
export async function runEndoflifeSync(): Promise<{ fetched: number; products: number; failed: string[] }> {
  let fetched = 0;
  let ok = 0;
  const failed: string[] = [];
  for (const product of TRACKED_PRODUCTS) {
    try {
      const rows = await fetchProduct(product);
      if (rows.length > 0) {
        await upsertRows(rows);
        fetched += rows.length;
        ok += 1;
      } else {
        failed.push(product);
      }
    } catch (err) {
      failed.push(product);
      console.error(`[endoflife] fetch failed for ${product}:`, (err as Error).message);
    }
  }
  try {
    await loadLifecycleFromDb();
  } catch (err) {
    console.error("[endoflife] cache reload failed:", (err as Error).message);
  }
  return { fetched, products: ok, failed };
}
