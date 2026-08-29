// Named-column-storage regression guard (security audit 2026-05-22 §1.3 /
// catalog T-401).
//
// The ingest schema uses .passthrough() (deliberately: ~14 collector
// fields are consumed by the evaluator without being declared in the Zod
// schema, so strict/strip would break them). That is SAFE only because
// the storage writer reads NAMED fields one by one
// (JSON.stringify(snap.cpu?.cores), JSON.stringify(snap.disks), ...) and
// never serializes the whole snapshot object. So unknown / attacker-
// supplied passthrough fields never reach ClickHouse.
//
// This test locks that invariant: if a future change introduces
// JSON.stringify(snap) / JSON.stringify(rawSnap) (whole-object), the
// passthrough fields would suddenly be stored and the T-401 mitigation
// would silently regress. Fail CI if that pattern appears in the writer.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE = join(__dirname, "..", "lifecycle.ts");

describe("ingest storage is named-column only (T-401 mitigation)", () => {
  const src = readFileSync(LIFECYCLE, "utf8");

  it("never serializes the whole snapshot object", () => {
    // Whole-object stringify of the snapshot/raw payload would carry
    // passthrough (unknown) fields into storage. Named-field stringify
    // (JSON.stringify(snap.cpu...), JSON.stringify(snap.disks...)) is fine.
    const wholeObjectPatterns = [
      /JSON\.stringify\(\s*snap\s*\)/,
      /JSON\.stringify\(\s*rawSnap\s*\)/,
      /JSON\.stringify\(\s*snapshot\s*\)/,
      /JSON\.stringify\(\s*payload\s*\)/,
    ];
    const offenders = wholeObjectPatterns.filter((re) => re.test(src));
    expect(
      offenders,
      "lifecycle.ts must JSON.stringify NAMED snapshot fields only (e.g. " +
        "JSON.stringify(snap.disks)), never the whole snapshot object -- " +
        "doing so would store .passthrough() unknown fields and regress the " +
        "T-401 mitigation. Declare + validate fields instead if whole-object " +
        "storage is ever needed.",
    ).toEqual([]);
  });

  it("does stringify named fields (sanity: the writer is actually field-wise)", () => {
    // Confirms the test is pointed at the right file / the writer shape
    // hasn't been refactored away from the named-column pattern.
    expect(/JSON\.stringify\(\s*snap\.\w/.test(src)).toBe(true);
  });
});

describe("chassis power provenance is actually persisted (2026-08-02)", () => {
  const lifecycle = readFileSync(join(__dirname, "..", "lifecycle.ts"), "utf-8");
  const migrations = join(__dirname, "..", "..", "..", "..", "..", "..", "..", "migrations", "clickhouse");

  it("maps snap.chassis into the column row", () => {
    // THE BUG CLASS THIS GUARDS. Ingest builds a NAMED-COLUMN row, so a new top-level
    // snapshot object is dropped no matter what the Zod schema permits. Confirmed
    // empirically on 2026-08-01: a canary agent pushed chassis successfully and the
    // field was simply absent downstream, because nothing mapped it here.
    expect(lifecycle).toMatch(/chassis:\s*JSON\.stringify\(snap\.chassis/);
  });

  it("has a migration creating the column it writes to", () => {
    // A mapping without a column throws at insert; a column without a mapping stores
    // nothing. They must land together.
    const sql = readFileSync(join(migrations, "006_snapshot_chassis.sql"), "utf-8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS chassis String DEFAULT/);
  });

  it("does not interpret the value at ingest", () => {
    // last_power_event is a bit set in which a healthy host can assert ac_failed, and
    // restart_cause names a management path rather than an actor. Any verdict belongs
    // in a calibrated rule, never in the writer.
    const chassisLine = lifecycle.split("\n").find((l) => /chassis:\s*JSON\.stringify/.test(l)) ?? "";
    expect(chassisLine).not.toMatch(/ac_failed|restart_cause|\?/);
  });
});
