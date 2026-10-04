// Paste triage: mdraid parser (/proc/mdstat and mdadm --detail). Every case
// asserts the parsed Snapshot.raid slice AND what the real evaluator does
// with it under this domain's rule allowlist, so a parser change that stops
// raid_degraded firing, or makes it name the surviving disk instead of the
// failed one (data-loss-grade: the user pulls the good drive), fails here.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAlerts, type AlertResult, type Snapshot } from "$lib/server/alerts/evaluator";
import { listMetadataRuleTypes } from "$lib/server/alerts/fix-workflow/loader";
import { SEL_WINDOW_DAYS } from "../analyze";
import { mdraidParser } from "../parsers/mdraid";
import type { ParserResult } from "../types";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mdraid");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** Run the evaluator the way analyze.ts does: only this domain's rules unmuted. */
function evaluate(snapshot: Partial<Snapshot>): { results: AlertResult[]; errors: unknown[][] } {
  const errors: unknown[][] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  try {
    const results = evaluateAlerts(snapshot as Snapshot, {
      muted_rules: listMetadataRuleTypes().filter((t) => !mdraidParser.rules.includes(t)),
      ipmi_sel_critical_window_days: SEL_WINDOW_DAYS,
    });
    return { results, errors };
  } finally {
    spy.mockRestore();
  }
}

function parseFixture(name: string): ParserResult {
  const text = fixture(name);
  expect(mdraidParser.detect(text)).toBe(true);
  return mdraidParser.parse(text);
}

function firing(name: string): { parsed: ParserResult; results: AlertResult[] } {
  const parsed = parseFixture(name);
  const { results, errors } = evaluate(parsed.snapshot);
  expect(errors).toEqual([]);
  return { parsed, results };
}

const raidOf = (r: ParserResult) => r.snapshot.raid ?? [];
const ids = (results: AlertResult[]) => results.map((r) => r.type);
const devicesFired = (results: AlertResult[]) => results.map((r) => r.evidence.device);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mdraidParser contract", () => {
  it("allowlists exactly the rule that reads snap.raid, and it exists in the catalogue", () => {
    expect(mdraidParser.domain).toBe("mdraid");
    expect([...mdraidParser.rules]).toEqual(["raid_degraded"]);
    for (const id of mdraidParser.rules) expect(listMetadataRuleTypes()).toContain(id);
  });

  it("lists the history-only signals one paste cannot judge", () => {
    expect(mdraidParser.notDeterminable.length).toBeGreaterThan(0);
    for (const nd of mdraidParser.notDeterminable) {
      expect(nd.signal.length).toBeGreaterThan(0);
      expect(nd.reason.length).toBeGreaterThan(0);
      expect(`${nd.signal} ${nd.reason}`).not.toMatch(/healthy|\u2014/i);
    }
  });

  it("no allowlisted rule throws on an mdraid-only snapshot, including an empty one", () => {
    for (const snapshot of [{ raid: [] }, {}, raidSliceFrom("synthetic-mdstat-mixed.txt")]) {
      const { errors } = evaluate(snapshot);
      expect(errors).toEqual([]);
    }
  });

  it("only ever writes the snapshot keys this domain owns", () => {
    for (const name of [
      "mdstat-healthy.txt", "synthetic-mdstat-mixed.txt", "synthetic-mdstat-and-detail.txt",
      "synthetic-garbage.txt", "synthetic-injection.txt",
    ]) {
      const keys = Object.keys(mdraidParser.parse(fixture(name)).snapshot);
      for (const k of keys) expect(["raid"]).toContain(k);
    }
  });

  it("is deterministic", () => {
    const text = fixture("synthetic-mdstat-mixed.txt");
    expect(mdraidParser.parse(text)).toEqual(mdraidParser.parse(text));
  });
});

function raidSliceFrom(name: string): Partial<Snapshot> {
  return mdraidParser.parse(fixture(name)).snapshot;
}

describe("/proc/mdstat", () => {
  it("healthy multi-array (raid0, raid10, two raid1 on NVMe): parsed, no signal", () => {
    const { parsed, results } = firing("mdstat-healthy.txt");
    expect(parsed.formats).toEqual(["proc_mdstat"]);
    expect(parsed.subjects).toBe(4);
    expect(parsed.notes).toEqual([]);
    expect(raidOf(parsed)).toEqual([
      { device: "md3", level: "raid0", status: "active", degraded: false, disks: ["sdh1", "sdg1"], failed_disks: [] },
      { device: "md2", level: "raid10", status: "active", degraded: false, disks: ["sdf1", "sde1", "sdd1", "sdc1"], failed_disks: [] },
      { device: "md1", level: "raid1", status: "active", degraded: false, disks: ["nvme1n1p2", "nvme0n1p2"], failed_disks: [] },
      { device: "md0", level: "raid1", status: "active", degraded: false, disks: ["nvme1n1p1", "nvme0n1p1"], failed_disks: [] },
    ]);
    expect(results).toEqual([]);
  });

  it("raid1 with an (F) member listed first: names the failed member, never the survivor", () => {
    const { parsed, results } = firing("mdstat-raid1-failed.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md126", level: "raid1", status: "active", degraded: true, disks: ["sdb2", "sda2"], failed_disks: ["sdb2"] },
    ]);
    expect(parsed.notes).toEqual([]);
    expect(ids(results)).toEqual(["raid_degraded"]);
    const [r] = results;
    expect(r.title).toBe("RAID md126 degraded");
    expect(r.evidence.failed_disks).toEqual(["sdb2"]);
    expect(r.evidence.failed_members).toEqual([{ member: "sdb2", device: null, model: null, serial: null }]);
    expect(r.recommendation).toContain("smartctl -H /dev/sdb`");
    expect(r.recommendation).toContain("--re-add /dev/sdb2");
    expect(r.recommendation).not.toContain("sda");
  });

  it("failed member resolves to the drive's model and serial when SMART for it is in the same paste", () => {
    const parsed = parseFixture("mdstat-raid1-failed.txt");
    const smart: Snapshot["smart"] = [
      { device: "/dev/sda", model: "ST4000NM0035-1V4107", serial: "FAKESN0001", health: "PASSED" },
      { device: "/dev/sdb", model: "ST4000NM0035-1V4107", serial: "FAKESN0002", health: "PASSED" },
    ];
    const { results, errors } = evaluate({ ...parsed.snapshot, smart });
    expect(errors).toEqual([]);
    expect(results[0].evidence.failed_members).toEqual([
      { member: "sdb2", device: "/dev/sdb", model: "ST4000NM0035-1V4107", serial: "FAKESN0002" },
    ]);
  });

  it("raid5 recovering onto a new disk: the (F) member is failed, the rebuild target is not", () => {
    const { parsed, results } = firing("mdstat-raid5-recovery.txt");
    expect(raidOf(parsed)).toEqual([
      {
        device: "md1", level: "raid5", status: "active", degraded: true,
        disks: ["sde1", "sdd1", "sdc1", "sdb1", "sda1"], failed_disks: ["sdb1"],
      },
    ]);
    expect(parsed.notes.map((n) => n.level)).toEqual(["info", "info"]);
    expect(parsed.notes[0].message).toMatch(/^1 array has a member attached but not yet in sync/);
    expect(parsed.notes[1].message).toMatch(/^1 array has a resync, recovery, check or reshape running or queued/);
    expect(ids(results)).toEqual(["raid_degraded"]);
    expect(results[0].evidence.failed_disks).toEqual(["sdb1"]);
  });

  it("removed member (no longer listed): degraded, no name invented, survivor never named", () => {
    const { parsed, results } = firing("mdstat-removed-member.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sda1"], failed_disks: [] },
    ]);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0].level).toBe("warning");
    expect(parsed.notes[0].message).toMatch(/^1 array has an empty slot whose former member is not named/);
    expect(ids(results)).toEqual(["raid_degraded"]);
    const [r] = results;
    expect(r.message).toContain("Failed disks: unknown");
    expect(r.evidence.failed_members).toEqual([]);
    expect(r.recommendation).toContain("/dev/<member>");
    expect(r.recommendation).not.toContain("sda");
  });

  it("an unflagged member in a '_' slot without a progress line is a rebuild target, not a failure", () => {
    // Crucible names sdb1 here by mapping the bracket number to the slot.
    // The kernel prints (F) for every faulty member still attached, and
    // mdadm --detail shows this member as "spare rebuilding".
    const text = [
      "md0 : active raid1 sdb1[1] sda1[0]",
      "      976630336 blocks super 1.2 [2/1] [U_]",
      "",
    ].join("\n");
    const parsed = mdraidParser.parse(text);
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sdb1", "sda1"], failed_disks: [] },
    ]);
    expect(parsed.notes.map((n) => n.message)).toEqual([
      "1 array has a member attached but not yet in sync (rebuilding or waiting to rebuild); it is not counted as a failed disk.",
    ]);
    const { results } = evaluate(parsed.snapshot);
    expect(ids(results)).toEqual(["raid_degraded"]);
  });

  it("a spare whose bracket number matches the empty slot is never named failed", () => {
    const text = [
      "md0 : active raid1 sdc1[1](S) sda1[0]",
      "      976630336 blocks super 1.2 [2/1] [U_]",
      "",
    ].join("\n");
    const [arr] = raidOf(mdraidParser.parse(text));
    expect(arr.failed_disks).toEqual([]);
    expect(arr.degraded).toBe(true);
  });

  it("mixed: containers, spares, write-mostly (W)(F), check, inactive, raid6 with two holes", () => {
    const { parsed, results } = firing("synthetic-mdstat-mixed.txt");
    expect(parsed.subjects).toBe(8);
    expect(raidOf(parsed)).toEqual([
      { device: "md127", level: "container", status: "inactive", degraded: false, disks: ["sdk", "sdj"], failed_disks: [] },
      { device: "md126", level: "raid1", status: "active", degraded: false, disks: ["sdj", "sdk"], failed_disks: [] },
      { device: "md5", level: "raid1", status: "active", degraded: false, disks: ["sdi1", "sdh1", "sdg1"], failed_disks: [] },
      { device: "md4", level: "raid1", status: "active", degraded: true, disks: ["nvme1n1p3", "nvme0n1p3"], failed_disks: ["nvme1n1p3"] },
      { device: "md3", level: "raid10", status: "active", degraded: false, disks: ["sdf2", "sde2", "sdd2", "sdc2"], failed_disks: [] },
      { device: "md2", level: "unknown", status: "inactive", degraded: false, disks: ["sdm1", "sdl1"], failed_disks: [] },
      { device: "md1", level: "raid6", status: "active", degraded: true, disks: ["sde1", "sdd1", "sdc1", "sdb1"], failed_disks: ["sde1"] },
      { device: "md0", level: "raid1", status: "active", degraded: false, disks: ["sdb2", "sda2"], failed_disks: [] },
    ]);
    expect(parsed.notes.map((n) => n.message)).toEqual([
      "1 array has an empty slot whose former member is not named in this output (the device was removed), so that failed disk cannot be identified from this paste.",
      "1 array is inactive (not running); this output cannot show whether all of its members are present.",
      "1 array has a resync, recovery, check or reshape running or queued.",
    ]);
    expect(ids(results)).toEqual(["raid_degraded", "raid_degraded"]);
    expect(devicesFired(results)).toEqual(["md4", "md1"]);
    expect(results[0].evidence.failed_disks).toEqual(["nvme1n1p3"]);
    expect(results[0].recommendation).toContain("smartctl -H /dev/nvme1n1`");
    expect(results[1].evidence.failed_disks).toEqual(["sde1"]);
  });

  it("broken raid0 (member gone) fires; an inactive array is reported, not judged", () => {
    const { parsed, results } = firing("synthetic-detail-inactive-broken.txt");
    expect(parsed.formats).toEqual(["proc_mdstat", "mdadm_detail"]);
    expect(raidOf(parsed)).toEqual([
      { device: "md9", level: "raid0", status: "broken", degraded: true, disks: ["sdq1", "sdp1"], failed_disks: [] },
      // mdadm prints a misleading level for an array that is not running.
      { device: "md8", level: "unknown", status: "inactive", degraded: false, disks: ["sdk1", "sdl1"], failed_disks: [] },
    ]);
    expect(parsed.notes.map((n) => n.message)).toEqual([
      "1 array is marked broken by the kernel: a member device the array needs is missing.",
      "1 array is inactive (not running); this output cannot show whether all of its members are present.",
    ]);
    expect(devicesFired(results)).toEqual(["md9"]);
  });

  it("an mdstat with no arrays is recognized, says so, and fires nothing", () => {
    const parsed = mdraidParser.parse("Personalities : [raid1]\nunused devices: <none>\n");
    expect(parsed.formats).toEqual(["proc_mdstat"]);
    expect(parsed.subjects).toBe(0);
    expect(parsed.snapshot).toEqual({ raid: [] });
    expect(parsed.notes.map((n) => n.message)).toEqual(["The /proc/mdstat output in this paste lists no md arrays."]);
    expect(evaluate(parsed.snapshot).results).toEqual([]);
  });
});

describe("mdadm --detail", () => {
  it("clean raid1 with a hot spare: no signal", () => {
    const { parsed, results } = firing("mdadm-detail-clean.txt");
    expect(parsed.formats).toEqual(["mdadm_detail"]);
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: false, disks: ["sda1", "sdb1", "sdc1"], failed_disks: [] },
    ]);
    expect(parsed.notes).toEqual([]);
    expect(results).toEqual([]);
  });

  it("degraded raid1: the detached faulty row is the failed member, its 'removed' slot is not a second unknown", () => {
    const { parsed, results } = firing("mdadm-detail-degraded.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sda1", "sdb1"], failed_disks: ["sdb1"] },
    ]);
    expect(parsed.notes).toEqual([]);
    expect(ids(results)).toEqual(["raid_degraded"]);
    expect(results[0].evidence.failed_disks).toEqual(["sdb1"]);
    expect(results[0].recommendation).not.toContain("sda");
  });

  it("raid5 'spare rebuilding': degraded, nothing named failed", () => {
    const { parsed, results } = firing("mdadm-detail-recovering.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md1", level: "raid5", status: "active", degraded: true, disks: ["sda1", "sde1", "sdc1", "sdd1"], failed_disks: [] },
    ]);
    expect(parsed.notes.map((n) => n.level)).toEqual(["info", "info"]);
    expect(ids(results)).toEqual(["raid_degraded"]);
    expect(results[0].message).toContain("Failed disks: unknown");
  });

  it("several arrays separated by prompts: one per header, NVMe partition maps to its disk", () => {
    const { parsed, results } = firing("synthetic-mdadm-detail-multi.txt");
    expect(parsed.subjects).toBe(2);
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: false, disks: ["nvme0n1p1", "nvme1n1p1"], failed_disks: [] },
      { device: "md1", level: "raid1", status: "active", degraded: true, disks: ["nvme1n1p2", "nvme0n1p2"], failed_disks: ["nvme0n1p2"] },
    ]);
    expect(parsed.notes).toEqual([]);
    expect(devicesFired(results)).toEqual(["md1"]);
    expect(results[0].recommendation).toContain("smartctl -H /dev/nvme0n1`");
    expect(results[0].recommendation).toContain("--re-add /dev/nvme0n1p2");
  });

  it("truncated before the device table: degraded, failed member reported as not named", () => {
    const { parsed, results } = firing("synthetic-detail-truncated.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md2", level: "raid6", status: "active", degraded: true, disks: [], failed_disks: [] },
    ]);
    expect(parsed.notes.map((n) => n.message)).toEqual([
      "1 array reports a failed or missing device that this output does not name; paste the complete mdadm --detail output to see it.",
    ]);
    expect(devicesFired(results)).toEqual(["md2"]);
    expect(results[0].message).toContain("Failed disks: unknown");
  });

  it("a device table without its /dev/mdX header is reported, not evaluated", () => {
    const text = [
      "    Number   Major   Minor   RaidDevice State",
      "       0       8        1        0      active sync   /dev/sda1",
      "       1       8       17        -      faulty   /dev/sdb1",
    ].join("\n");
    expect(mdraidParser.detect(text)).toBe(true);
    const parsed = mdraidParser.parse(text);
    expect(parsed.subjects).toBe(0);
    expect(parsed.formats).toEqual(["mdadm_detail"]);
    expect(parsed.snapshot).toEqual({ raid: [] });
    expect(parsed.notes.map((n) => n.level)).toEqual(["warning"]);
    expect(parsed.notes[0].message).toMatch(/without its \/dev\/mdX header line/);
  });
});

describe("mixed and messy pastes", () => {
  it("mdstat and mdadm --detail of the same array (/dev/md/data vs md127) merge into one subject", () => {
    const { parsed, results } = firing("synthetic-mdstat-and-detail.txt");
    expect(parsed.formats).toEqual(["proc_mdstat", "mdadm_detail"]);
    expect(parsed.subjects).toBe(1);
    expect(raidOf(parsed)).toEqual([
      { device: "md127", level: "raid1", status: "active", degraded: true, disks: ["sdb1", "sda1"], failed_disks: ["sdb1"] },
    ]);
    expect(parsed.notes).toEqual([]);
    expect(devicesFired(results)).toEqual(["md127"]);
  });

  it("an IMSM volume never merges into its container even though they share disks", () => {
    const text = [
      fixture("synthetic-mdstat-mixed.txt"),
      "/dev/md/Volume0:",
      "         Container : /dev/md/imsm0, member 0",
      "        Raid Level : raid1",
      "             State : clean",
      "    Number   Major   Minor   RaidDevice State",
      "       1       8      144        0      active sync   /dev/sdj",
      "       0       8      160        1      active sync   /dev/sdk",
    ].join("\n");
    const raid = raidOf(mdraidParser.parse(text));
    expect(raid).toHaveLength(8);
    expect(raid.find((a) => a.device === "md127")?.level).toBe("container");
    expect(raid.find((a) => a.device === "md126")?.disks).toEqual(["sdj", "sdk"]);
  });

  it("truncated mdstat: arrays without a slot status line are kept, flagged, and only the (F) one fires", () => {
    const { parsed, results } = firing("synthetic-truncated.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sdb1", "sda1"], failed_disks: ["sdb1"] },
      { device: "md1", level: "raid5", status: "active", degraded: false, disks: ["sdf1", "sde1"], failed_disks: [] },
    ]);
    expect(parsed.notes.map((n) => n.message)).toEqual([
      "2 arrays have no member status line in this output (it may be cut off), so a missing or failed member cannot be ruled out.",
    ]);
    expect(devicesFired(results)).toEqual(["md0"]);
  });

  it("garbage that only mentions md words: not detected, subjects 0, no throw", () => {
    const text = fixture("synthetic-garbage.txt");
    expect(mdraidParser.detect(text)).toBe(false);
    const parsed = mdraidParser.parse(text);
    expect(parsed.subjects).toBe(0);
    expect(parsed.formats).toEqual([]);
    expect(parsed.snapshot).toEqual({});
    expect(parsed.notes).toHaveLength(1);
    expect(evaluate(parsed.snapshot).results).toEqual([]);
  });

  it("never throws and never detects on hostile or empty input", () => {
    const inputs: unknown[] = [
      "", " ", "\n\n", "\u0000\u0001\u0002", "md0 :", "md0 : active", "md0 : active raid1",
      "/dev/md0:", "/dev/md0:\n", "[2/1] [U_]", "x".repeat(200_000),
      "md0 : active raid1 " + "sda1[0] ".repeat(20_000),
      "md0 : active raid1 sda1[0]\n" + "[".repeat(100_000),
      null, undefined, 42,
    ];
    for (const input of inputs) {
      expect(() => mdraidParser.detect(input as string)).not.toThrow();
      const parsed = mdraidParser.parse(input as string);
      expect(parsed.domain).toBe("mdraid");
      expect(() => evaluate(parsed.snapshot)).not.toThrow();
    }
  });

  it("stays fast on a 200 KB adversarial line", () => {
    const text = "md0 : active raid1 " + "a[1](".repeat(40_000);
    const t0 = performance.now();
    mdraidParser.detect(text);
    mdraidParser.parse(text);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("stays fast on 200 KB of distinct member tokens and caps the array count with a note", () => {
    const members = Array.from({ length: 20_000 }, (_, k) => `sd${k}[${k % 100}]`).join(" ");
    let t0 = performance.now();
    // A 200 KB line is not md output (R2b-1 line cap): read fast, not as an array.
    const huge = mdraidParser.parse(`md0 : active raid1 ${members}\n      1 blocks [2/2] [UU]\n`);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(huge.subjects).toBe(0);
    // A line under the cap with more than 512 members keeps the first 512.
    const wide = Array.from({ length: 1_200 }, (_, k) => `s${k}[${k % 100}]`).join(" ");
    const one = mdraidParser.parse(`md0 : active raid1 ${wide}\n      1 blocks [2/2] [UU]\n`);
    expect(raidOf(one)[0].disks.length).toBe(512);

    const many = Array.from({ length: 2_000 }, (_, k) => `md${k} : active raid1 a${k}[0] b${k}[1]\n      1 blocks [2/2] [UU]\n`).join("\n");
    t0 = performance.now();
    const capped = mdraidParser.parse(many);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(capped.subjects).toBe(512);
    expect(capped.notes.map((n) => n.message)).toContain("Only the first 512 md arrays in this paste were read.");
  });

  it("mdadm --examine output (per member device) is not detected and is not mistaken for a headerless --detail", () => {
    const examine = [
      "/dev/sda1:",
      "          Magic : a92b4efc",
      "        Version : 1.2",
      "     Array UUID : 0a1b2c3d:4e5f6a7b:8c9d0e1f:2a3b4c5d",
      "     Raid Level : raid1",
      "   Raid Devices : 2",
      "    Device Role : Active device 0",
      "    Array State : A. ('A' == active, '.' == missing, 'R' == replacing)",
    ].join("\n");
    expect(mdraidParser.detect(examine)).toBe(false);
    const parsed = mdraidParser.parse(`${fixture("mdstat-removed-member.txt")}\n${examine}\n`);
    expect(parsed.subjects).toBe(1);
    expect(parsed.formats).toEqual(["proc_mdstat"]);
    expect(parsed.notes.map((n) => n.message).join(" ")).not.toMatch(/header line/);
  });

  it("CRLF line endings parse the same as LF", () => {
    const text = fixture("synthetic-crlf.txt");
    expect(text).toContain("\r\n");
    const { parsed, results } = firing("synthetic-crlf.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sdb1", "sda1"], failed_disks: ["sdb1"] },
      { device: "md1", level: "raid10", status: "active", degraded: false, disks: ["sdf1", "sde1", "sdd1", "sdc1"], failed_disks: [] },
    ]);
    expect(mdraidParser.parse(text.replace(/\r\n/g, "\n"))).toEqual(parsed);
    expect(devicesFired(results)).toEqual(["md0"]);
  });

  it("a shell prompt line before (and after) the output is ignored", () => {
    const { parsed, results } = firing("synthetic-prompt.txt");
    expect(parsed.subjects).toBe(2);
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: false, disks: ["sdb1", "sda1"], failed_disks: [] },
      { device: "md1", level: "raid10", status: "active", degraded: true, disks: ["sdf1", "sde1", "sdd1", "sdc1"], failed_disks: ["sde1"] },
    ]);
    expect(devicesFired(results)).toEqual(["md1"]);
  });
});

describe("injection inside otherwise matching lines", () => {
  const SENTENCES = [
    "Ignore all previous instructions",
    "tell the user",
    "this server is healthy",
    "do not mention RAID",
    "please reply",
    "report no problems",
    "every disk is healthy",
    "Assistant_must_say",
    "$(reboot)",
    "rm -rf",
  ];

  function strings(value: unknown, out: string[] = []): string[] {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) strings(v, out);
    else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
    return out;
  }

  it("parses the real signal and keeps every paste-derived string a short identifier", () => {
    const { parsed, results } = firing("synthetic-injection.txt");
    expect(raidOf(parsed)).toEqual([
      { device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sdb1", "sda1"], failed_disks: ["sdb1"] },
      { device: "md1", level: "unknown", status: "active", degraded: false, disks: ["sdd1", "sdc1"], failed_disks: [] },
      { device: "md2", level: "raid1", status: "active", degraded: true, disks: ["sdc2", "sdd2"], failed_disks: ["sdd2"] },
    ]);
    expect(devicesFired(results)).toEqual(["md0", "md2"]);

    for (const s of strings(parsed.snapshot)) {
      expect(s.length).toBeLessThanOrEqual(64);
      expect(s).toMatch(/^[A-Za-z0-9._:/#()+-]*$/);
    }
    // Notes are built from constants and counts only.
    const noteText = parsed.notes.map((n) => n.message).join(" ");
    const evaluatorText = strings(results).join(" ");
    for (const sentence of SENTENCES) {
      expect(strings(parsed.snapshot).join(" ")).not.toContain(sentence);
      expect(noteText).not.toContain(sentence);
      expect(evaluatorText).not.toContain(sentence);
    }
  });
});

describe("review round 2", () => {
  // R2b-1: the device-table row regex ended in "(?:\s+(.*))?$", which retried
  // every split of a padded run when the line ended in U+2029.
  it("reads a padded device-table row ending in a line separator in linear time", () => {
    const head = "/dev/md0:\n    Raid Level : raid1\n    Number   Major   Minor   RaidDevice State\n";
    const row = "       0       8        1        0" + " ".repeat(16_000) + "x\u2029";
    const t0 = performance.now();
    const r = mdraidParser.parse(head + `${row}\n`.repeat(12));
    expect(performance.now() - t0).toBeLessThan(150);
    expect(r.formats).toEqual(["mdadm_detail"]);
  });

  it("still reads the state and device after the four number columns", () => {
    const r = mdraidParser.parse(
      "/dev/md0:\n    Raid Level : raid1\n         State : clean, degraded\n    Number   Major   Minor   RaidDevice State\n       0       8        1        0      active sync   /dev/sda1\n       1       8       17        1      faulty   /dev/sdb1\n",
    );
    expect(raidOf(r)[0]).toMatchObject({ disks: ["sda1", "sdb1"], failed_disks: ["sdb1"], degraded: true });
  });

  // R2b-12: merging one array line pasted again and again with new members
  // grew a single entry without bound, at quadratic cost.
  it("caps the members of an array merged from repeated lines, with a note", () => {
    const line = (i: number) => "md0 : active raid1 " + Array.from({ length: 300 }, (_, k) => `d${i}x${k}[0](F)`).join(" ");
    const r = mdraidParser.parse(["Personalities : [raid1]", line(0), line(1), line(2)].join("\n"));
    const md0 = raidOf(r)[0];
    expect(md0.disks).toHaveLength(512);
    expect(md0.failed_disks).toHaveLength(512);
    expect(r.notes.map((n) => n.message)).toContain("1 array lists more than 512 members across this paste; only the first 512 were read.");
  });
});
