// In-memory OS-lifecycle cache for the os_end_of_life rule.
//
// The evaluator runs synchronously per snapshot at ingest time, so it cannot
// do an async DB read. This module holds the synced endoflife.date dataset in
// process memory; the sync job (job.ts) refreshes it from Postgres on startup
// and from the endoflife.date API on a daily cron. A cold process with an
// empty cache simply returns null and the rule degrades silently (no alert).
//
// Data provenance: endoflife.date (https://endoflife.date), data licensed
// CC BY-SA. We store only lifecycle dates (facts), not the descriptive prose.

export interface LifecycleRow {
  product: string; // endoflife.date slug, e.g. "ubuntu"
  cycle: string; // release name, e.g. "24.04" / "9" / "2023"
  label: string | null;
  // Standard security-support end (endoflife.date `eolFrom`). Null => no known
  // EOL for this cycle (rolling / undated future release).
  eol_from: string | null; // ISO date (YYYY-MM-DD)
  // Extended-support end (Ubuntu ESM / RHEL ELS, endoflife.date `eoesFrom`).
  // Null when the cycle has no extended track.
  eoes_from: string | null; // ISO date
  is_lts: boolean;
}

export interface LifecycleLookup {
  product: string;
  cycle: string;
  label: string | null;
  eolFrom: Date | null;
  eoesFrom: Date | null;
  isLts: boolean;
}

// product slug -> that product's release rows.
let cache: Map<string, LifecycleRow[]> = new Map();
let loadedAt: number | null = null;

export function setLifecycleCache(rows: LifecycleRow[]): void {
  const next = new Map<string, LifecycleRow[]>();
  for (const r of rows) {
    const list = next.get(r.product) ?? [];
    list.push(r);
    next.set(r.product, list);
  }
  cache = next;
  loadedAt = Date.now();
}

export function lifecycleCacheState(): { products: number; rows: number; loadedAt: number | null } {
  let rows = 0;
  for (const list of cache.values()) rows += list.length;
  return { products: cache.size, rows, loadedAt };
}

/** Test-only: clear the cache so unit tests start from a known state. */
export function __resetLifecycleCacheForTests(): void {
  cache = new Map();
  loadedAt = null;
}

// os_id (lowercased, from /etc/os-release ID=) -> endoflife.date product slug.
const SLUG_BY_OS_ID: Record<string, string> = {
  ubuntu: "ubuntu",
  debian: "debian",
  rhel: "rhel",
  rocky: "rocky-linux",
  almalinux: "almalinux",
  centos: "centos", // overridden to centos-stream when the name says "Stream"
  amzn: "amazon-linux",
  sles: "sles",
  "opensuse-leap": "opensuse", // os_id is opensuse-leap; endoflife.date slug is opensuse
  ol: "oracle-linux", // Oracle Linux os_id is "ol"
};

// Products whose lifecycle is tracked by the FULL minor (service pack), not
// the major. Truncating these to the major would map to the wrong cycle.
const KEEP_MINOR = new Set(["sles", "opensuse-leap"]);

/**
 * Map an os-release identity to an endoflife.date (product slug, cycle).
 * Returns null when we do not model the distro. Pure; no I/O.
 *
 * Gotchas handled (per both currency research passes):
 *   - Ubuntu 24.04.1 -> cycle 24.04 (YY.MM, not the point respin)
 *   - RHEL/Rocky/Alma/CentOS 9.5 -> major "9"
 *   - centos vs centos-stream (same os_id; disambiguated by PRETTY_NAME)
 *   - Amazon Linux 2 vs 2023 (idiosyncratic; version_id is already the cycle)
 *   - SLES / openSUSE Leap keep the minor (15.7, 15.6)
 */
export function normalizeToSlugCycle(
  osId: string | undefined,
  osVersionId: string | undefined,
  osName: string | undefined,
): { product: string; cycle: string } | null {
  if (!osId || !osVersionId) return null;
  const id = osId.toLowerCase();
  let product = SLUG_BY_OS_ID[id];
  if (!product) return null;

  // CentOS Stream shares os_id=centos with legacy CentOS Linux but has a
  // different lifecycle; the PRETTY_NAME carries "Stream".
  if (product === "centos" && /stream/i.test(osName ?? "")) {
    product = "centos-stream";
  }

  const v = osVersionId.trim();
  let cycle: string;
  if (id === "ubuntu") {
    // 24.04.1 -> 24.04 ; 24.04 -> 24.04
    const parts = v.split(".");
    cycle = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0];
  } else if (KEEP_MINOR.has(id)) {
    cycle = v; // service-pack granularity
  } else {
    // debian / rhel / rocky / alma / centos(-stream) / amzn / oracle: major.
    // Amazon Linux version_id is already "2" or "2023"; taking the first
    // dot-part is a no-op there.
    cycle = v.split(".")[0];
  }
  if (!cycle) return null;
  return { product, cycle };
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Look up the lifecycle record for a host's OS. Null when unmodelled or the
 *  cache lacks the (product, cycle). Synchronous cache read. */
export function lookupLifecycle(system: {
  os_id?: string;
  os_version_id?: string;
  os?: string;
}): LifecycleLookup | null {
  const sc = normalizeToSlugCycle(system.os_id, system.os_version_id, system.os);
  if (!sc) return null;
  const rows = cache.get(sc.product);
  if (!rows) return null;
  const row = rows.find((r) => r.cycle === sc.cycle);
  if (!row) return null;
  return {
    product: row.product,
    cycle: row.cycle,
    label: row.label,
    eolFrom: parseDate(row.eol_from),
    eoesFrom: parseDate(row.eoes_from),
    isLts: row.is_lts,
  };
}
