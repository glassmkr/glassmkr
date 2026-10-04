// kernel_log paste parser: parsed slice plus the end-to-end verdict from the
// real evaluator with only this domain's rules unmuted.
//
// Fixtures without the synthetic- prefix follow the kernel's own printk
// format strings line for line (drivers/scsi/constants.c + scsi_logging.c,
// drivers/nvme/host/pci.c, fs/ext4/super.c, drivers/edac/edac_mc.c, NVIDIA's
// Xid catalogue examples) and journalctl / rsyslog prefixes, with fake
// hostnames, UUIDs and addresses. synthetic-* files are hand-built edge cases.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { evaluateAlerts, type AlertResult, type Snapshot } from "$lib/server/alerts/evaluator";
import { listMetadataRuleTypes } from "$lib/server/alerts/fix-workflow/loader";
import { kernelLogParser } from "../parsers/kernel-log";
import { DISK_IO_GREP, SEL_WINDOW_DAYS, analyzeOutput, renderAnalysisText } from "../analyze";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "kernel_log");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

const MUTED = listMetadataRuleTypes().filter((t) => !kernelLogParser.rules.includes(t));

function evaluate(slice: Partial<Snapshot>): { alerts: AlertResult[]; errors: unknown[][] } {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const alerts = evaluateAlerts(slice as Snapshot, {
      muted_rules: MUTED,
      ipmi_sel_critical_window_days: SEL_WINDOW_DAYS,
    });
    return { alerts, errors: [...errSpy.mock.calls] };
  } finally {
    errSpy.mockRestore();
    logSpy.mockRestore();
  }
}

function types(alerts: AlertResult[]): string[] {
  return alerts.map((a) => a.type).sort();
}

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

function tier1(slice: Partial<Snapshot>) {
  const t = slice.gpu?.tier1;
  if (!t || !t.available) throw new Error("expected gpu.tier1.available");
  return t;
}

const ALL_FIXTURES = [
  "synthetic-journalctl-k-ata-passthrough-noise.txt",
  "synthetic-dmesg-T-nvme-media-error-6x.txt",
  "synthetic-dmesg-writesame-illegal-request.txt",
  "dmesg-healthy-boot.txt",
  "dmesg-T-sata-medium-error.txt",
  "dmesg-iso-nvme-reset.txt",
  "journalctl-k-xid.txt",
  "kern-log-edac.txt",
  "synthetic-mixed-multi-subject.txt",
  "synthetic-truncated.txt",
  "synthetic-garbage.txt",
  "synthetic-crlf.txt",
  "synthetic-prompt.txt",
  "synthetic-injection.txt",
  "synthetic-journalctl-mce-fatal-prevboot.txt",
  "synthetic-dmesg-T-mce-logged.txt",
  "synthetic-dmesg-T-ghes-memory-ue.txt",
  "synthetic-dmesg-T-ghes-with-edac-ue.txt",
  "synthetic-dmesg-T-btrfs-forced-readonly.txt",
  "synthetic-dmesg-T-xfs-shutdown.txt",
  "synthetic-dmesg-T-libata-unc-only.txt",
  "synthetic-dmesg-T-libata-unc-full.txt",
];

describe("kernelLogParser metadata", () => {
  it("lists only rule ids that exist in the catalogue", () => {
    const known = new Set(listMetadataRuleTypes());
    for (const id of kernelLogParser.rules) expect(known.has(id), id).toBe(true);
    expect([...kernelLogParser.rules].sort()).toEqual(
      ["disk_io_errors", "ecc_errors", "filesystem_readonly", "gpu_xid_critical", "mce_uncorrected"],
    );
  });

  it("names concrete history-only signals without em-dashes", () => {
    expect(kernelLogParser.notDeterminable.length).toBeGreaterThan(0);
    for (const nd of kernelLogParser.notDeterminable) {
      expect(nd.signal.length).toBeGreaterThan(0);
      expect(nd.reason.length).toBeGreaterThan(0);
      expect(nd.signal + nd.reason).not.toMatch(/\u2014/);
    }
  });
});

describe("kernelLogParser.detect", () => {
  it("recognises every kernel log fixture and rejects garbage", () => {
    for (const name of ALL_FIXTURES) {
      expect(kernelLogParser.detect(fixture(name)), name).toBe(name !== "synthetic-garbage.txt");
    }
  });

  it("does not claim other tools' output or a userspace-only journal", () => {
    const smartctl = "smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.8.0-45-generic] (local build)\n=== START OF INFORMATION SECTION ===\nDevice Model:     ST4000NM0035-1V4107\nSMART overall-health self-assessment test result: PASSED\n";
    const zpool = "  pool: tank\n state: ONLINE\n  scan: scrub repaired 0B in 05:12:44 with 0 errors on Sun Sep 14 05:36:45 2026\nconfig:\n\n\tNAME        STATE     READ WRITE CKSUM\n\ttank        ONLINE       0     0     0\n";
    const sel = "   1 | 09/28/26 | 14:23:05 UTC | Memory #0x02 | Correctable ECC | Asserted\n";
    const userspace = "Oct 03 09:00:00 host-example sshd[4242]: Accepted publickey for root from 203.0.113.7 port 50022 ssh2\nOct 03 09:00:01 host-example systemd[1]: Started session-1.scope.\n";
    const appLog = "2026-10-03T10:00:00Z server started\n2026-10-03T10:00:01Z listening\n";
    for (const text of [smartctl, zpool, sel, userspace, appLog, "", "\u0000\u0001", "x".repeat(300_000)]) {
      expect(kernelLogParser.detect(text)).toBe(false);
    }
  });
});

describe("healthy boot log", () => {
  const r = kernelLogParser.parse(fixture("dmesg-healthy-boot.txt"));

  it("reads the log and finds no event", () => {
    expect(r.domain).toBe("kernel_log");
    expect(r.formats).toEqual(["dmesg"]);
    // Subjects are kernel log records read, so a clean log still takes part
    // in evaluation and its rules report "no matching signal".
    expect(r.subjects).toBe(27);
    expect(r.snapshot.dmesg_events).toEqual({
      available: true,
      events: [],
      events_by_type: { scsi_sense: 0, nvme_reset: 0, ext4_remount_readonly: 0 },
      window_seconds: 0,
    });
    // Absent lines are not zero counters: no io_errors / ecc_edac / gpu keys.
    expect(Object.keys(r.snapshot).sort()).toEqual(["dmesg_events"]);
    expect(r.notes.map((n) => n.message)).toEqual([
      "Read 27 kernel log lines; none matched a SCSI sense, NVMe controller fault, ext4 read-only remount, block I/O error, NVIDIA Xid or EDAC memory error line.",
    ]);
  });

  it("does not count the boot-time 'Shutdown timeout set to N seconds' line as an NVMe reset", () => {
    // Crucible's /nvme\s+(nvme\d+):\s+.*?(timeout|reset|aborting|disabling)/i matches it.
    expect(fixture("dmesg-healthy-boot.txt")).toContain("nvme nvme0: Shutdown timeout set to 8 seconds");
    expect(r.snapshot.dmesg_events?.events).toEqual([]);
  });

  it("fires nothing end to end", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(alerts).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("dmesg -T: SATA medium error, I/O errors and EXT4 remount", () => {
  const r = kernelLogParser.parse(fixture("dmesg-T-sata-medium-error.txt"));

  it("parses the sense key, the I/O error lines and the remount with zone-less local times", () => {
    expect(r.formats).toEqual(["dmesg"]);
    expect(r.snapshot.dmesg_events?.events).toEqual([
      {
        timestamp_iso: "2026-10-03T09:41:07",
        raw_line: "",
        event_type: "scsi_sense",
        severity: "critical",
        details: { device: "sdc", sense_key: "Medium Error" },
      },
      {
        timestamp_iso: "2026-10-03T09:41:12",
        raw_line: "",
        event_type: "ext4_remount_readonly",
        severity: "critical",
        details: { device: "sdc1", remount_readonly: true },
      },
    ]);
    expect(r.snapshot.io_errors).toEqual({ count: 2, devices: ["sdc", "sdc1"] });
    // 16 prefixed records; the ATA "res ..." continuation line has no prefix.
    expect(r.subjects).toBe(16);
    expect(r.notes.map((n) => n.message)).toContain(
      "Event times for 4 lines carry no time zone and are reported as printed.",
    );
    expect(r.notes.some((n) => n.message.startsWith("Event times are unknown"))).toBe(false);
  });

  it("fires disk_io_errors (legacy + sense key) and filesystem_readonly", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    expect(types(alerts)).toEqual(["disk_io_errors", "disk_io_errors", "filesystem_readonly"]);
    expect(alerts.map((a) => a.title).sort()).toEqual([
      "2 I/O error(s) on sdc, sdc1",
      "EXT4 sdc1 remounted read-only",
      "SCSI sense: Medium Error on sdc",
    ]);
    expect(alerts.every((a) => a.severity === "critical")).toBe(true);
  });
});

describe("dmesg --time-format iso: NVMe timeout and reset", () => {
  const r = kernelLogParser.parse(fixture("dmesg-iso-nvme-reset.txt"));

  it("parses the timeout lines as nvme_reset with UTC times and skips the abort status line", () => {
    expect(r.formats).toEqual(["dmesg"]);
    expect(r.snapshot.dmesg_events?.events).toEqual([
      {
        timestamp_iso: "2026-10-02T23:14:05.118Z",
        raw_line: "",
        event_type: "nvme_reset",
        severity: "critical",
        details: { controller: "nvme1", action: "timeout" },
      },
      {
        timestamp_iso: "2026-10-02T23:14:35.630Z",
        raw_line: "",
        event_type: "nvme_reset",
        severity: "critical",
        details: { controller: "nvme1", action: "timeout" },
      },
    ]);
    expect(r.snapshot.io_errors).toEqual({ count: 2, devices: ["nvme1n1"] });
    expect(r.notes.some((n) => n.message.startsWith("Event times"))).toBe(false);
  });

  it("fires disk_io_errors for both resets and the I/O error count", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    expect(types(alerts)).toEqual(["disk_io_errors", "disk_io_errors", "disk_io_errors"]);
    expect(alerts.map((a) => a.title).sort()).toEqual([
      "2 I/O error(s) on nvme1n1",
      "NVMe controller nvme1 timeout",
      "NVMe controller nvme1 timeout",
    ]);
  });
});

describe("journalctl -k: NVIDIA Xid", () => {
  const text = fixture("journalctl-k-xid.txt");
  const r = kernelLogParser.parse(text);

  it("parses every Xid with Crucible's severity table and unknown (year-less) times", () => {
    expect(r.formats).toEqual(["journalctl_kernel"]);
    const t = tier1(r.snapshot);
    expect(t.gpus).toEqual([]);
    expect(t.xid_events).toEqual([
      { timestamp_iso: "", xid_code: 94, pci_bdf: "0000:3b:00", severity: "critical", raw_message: "" },
      { timestamp_iso: "", xid_code: 94, pci_bdf: "0000:3b:00", severity: "critical", raw_message: "" },
      { timestamp_iso: "", xid_code: 79, pci_bdf: "0000:af:00", severity: "critical", raw_message: "" },
      { timestamp_iso: "", xid_code: 8, pci_bdf: "0000:5e:00", severity: "warning", raw_message: "" },
    ]);
    expect(r.snapshot.gpu?.available).toBe(true);
    expect(r.notes.map((n) => n.message)).toContain(
      "Event times are unknown for 4 lines (relative or year-less timestamps); no such event is treated as recent.",
    );
  });

  it("never copies the hostname", () => {
    expect(text).toContain("gpu-node-example");
    expect(JSON.stringify(r)).not.toContain("gpu-node-example");
  });

  it("fires one gpu_xid_critical per (GPU, code) group, without inventing event times", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    expect(types(alerts)).toEqual(["gpu_xid_critical", "gpu_xid_critical"]);
    const byCode = new Map(alerts.map((a) => [a.evidence?.xid_code, a]));
    expect(byCode.get(94)?.evidence).toMatchObject({ pci_bdf: "0000:3b:00", events_in_window: 2, first_event_iso: "", last_event_iso: "" });
    expect(byCode.get(79)?.title).toBe("GPU XID 79 on 0000:af:00 (GPU has fallen off the bus)");
  });
});

describe("/var/log/kern.log: EDAC memory errors", () => {
  const r = kernelLogParser.parse(fixture("kern-log-edac.txt"));

  it("sums CE / UE counts per DIMM label", () => {
    expect(r.formats).toEqual(["syslog_kernel"]);
    expect(r.snapshot.ecc_edac).toEqual({
      edac_corrected_total: 2,
      edac_uncorrected_total: 1,
      dimms: [
        { label: "CPU_SrcID#0_MC#0_Chan#1_DIMM#0", location: "", size_mb: null, ce_count: 2, ue_count: 0 },
        { label: "CPU_SrcID#1_MC#0_Chan#0_DIMM#0", location: "", size_mb: null, ce_count: 0, ue_count: 1 },
      ],
    });
    expect(r.subjects).toBe(5);
    const msgs = r.notes.map((n) => n.message);
    expect(msgs).toContain("2 corrected memory errors were logged; whether that rate is a problem needs readings over time.");
    expect(msgs.some((m) => m.startsWith("Memory error counts are summed from EDAC lines"))).toBe(true);
    expect(msgs).toContain("Event times are unknown for 3 lines (relative or year-less timestamps); no such event is treated as recent.");
  });

  it("fires ecc_errors and mce_uncorrected on the one UE", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    expect(types(alerts)).toEqual(["ecc_errors", "mce_uncorrected"]);
    expect(alerts.find((a) => a.type === "mce_uncorrected")?.title).toBe(
      "Uncorrected memory error: CPU_SrcID#1_MC#0_Chan#0_DIMM#0 (1)",
    );
    expect(alerts.find((a) => a.type === "ecc_errors")?.title).toBe("1 uncorrectable ECC error(s)");
  });

  it("CE-only EDAC lines do not fire (the CE rule needs a rate over time)", () => {
    const ce = kernelLogParser.parse(
      "[ 10.000001] EDAC MC0: 3 CE memory read error on DIMM_A1 (channel:0 slot:0 page:0x1 offset:0x0 grain:8 syndrome:0x0)\n",
    );
    expect(ce.snapshot.ecc_edac?.edac_corrected_total).toBe(3);
    expect(evaluate(ce.snapshot).alerts).toEqual([]);
  });
});

describe("mixed multi-subject paste", () => {
  const r = kernelLogParser.parse(fixture("synthetic-mixed-multi-subject.txt"));

  it("keeps every subject apart", () => {
    const events = r.snapshot.dmesg_events!.events;
    expect(r.snapshot.dmesg_events!.events_by_type).toEqual({ scsi_sense: 3, nvme_reset: 2, ext4_remount_readonly: 1 });
    expect(events.filter((e) => e.event_type === "scsi_sense").map((e) => [e.details.device, e.details.sense_key, e.severity])).toEqual([
      ["sda", "Medium Error", "critical"],
      ["sdb", "Unit Attention", "warning"],
      // "Sense Key : 0x4" from a kernel without CONFIG_SCSI_CONSTANTS.
      ["sde", "Hardware Error", "critical"],
    ]);
    expect(events.filter((e) => e.event_type === "nvme_reset").map((e) => [e.details.controller, e.details.action])).toEqual([
      ["nvme0", "timeout"],
      ["nvme2", "reset"],
    ]);
    expect(events.every((e) => e.timestamp_iso === "")).toBe(true);
    // fd0 is the VM floppy; its I/O error is not a disk signal.
    expect(r.snapshot.io_errors).toEqual({ count: 1, devices: ["sda"] });
    expect(tier1(r.snapshot).xid_events.map((x) => [x.pci_bdf, x.xid_code, x.severity])).toEqual([
      ["0000:3b:00", 79, "critical"],
      ["0000:86:00", 48, "critical"],
    ]);
    expect(r.snapshot.ecc_edac).toMatchObject({ edac_corrected_total: 2, edac_uncorrected_total: 1 });
    expect(r.subjects).toBe(15);
    expect(r.notes.map((n) => n.message)).toContain(
      "1 I/O error line on a floppy, optical, loop, network or virtual block device was not counted.",
    );
  });

  it("fires every domain rule with the right multiplicity", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    const counts: Record<string, number> = {};
    for (const a of alerts) counts[a.type] = (counts[a.type] ?? 0) + 1;
    expect(counts).toEqual({
      disk_io_errors: 6,
      filesystem_readonly: 1,
      gpu_xid_critical: 2,
      ecc_errors: 1,
      mce_uncorrected: 1,
    });
    const warn = alerts.filter((a) => a.severity === "warning").map((a) => a.title);
    expect(warn).toEqual(["SCSI sense: Unit Attention on sdb"]);
  });
});

describe("truncated paste", () => {
  it("parses the complete lines and ignores the cut first and last lines", () => {
    const r = kernelLogParser.parse(fixture("synthetic-truncated.txt"));
    expect(r.snapshot.dmesg_events?.events.map((e) => [e.event_type, e.details.device])).toEqual([
      ["ext4_remount_readonly", "sdd1"],
    ]);
    expect(r.snapshot.io_errors).toEqual({ count: 1, devices: ["sdd"] });
    expect(r.snapshot.gpu).toBeUndefined();
    expect(r.subjects).toBe(4);
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    expect(types(alerts)).toEqual(["disk_io_errors", "filesystem_readonly"]);
  });
});

describe("garbage", () => {
  it("returns subjects 0, no snapshot keys and a note, without throwing", () => {
    const r = kernelLogParser.parse(fixture("synthetic-garbage.txt"));
    expect(r).toEqual({
      domain: "kernel_log",
      formats: [],
      snapshot: {},
      subjects: 0,
      notes: [{ level: "info", message: "No kernel log lines were recognised." }],
    });
    expect(evaluate(r.snapshot).alerts).toEqual([]);
  });

  it("counts an un-prefixed line only when it matches an event (dmesg -t, grep output)", () => {
    const r = kernelLogParser.parse("some unrelated text\nEXT4-fs (sda1): Remounting filesystem read-only\n");
    expect(r.subjects).toBe(1);
    expect(r.formats).toEqual(["dmesg"]);
  });

  it("survives hostile shapes", () => {
    for (const text of ["", "\n\n\r\r", "[", "[ 1.0]", "x".repeat(500_000), "EDAC MC0: 99999999999 UE on X (", "NVRM: Xid (PCI:zz): 79"]) {
      expect(() => kernelLogParser.parse(text)).not.toThrow();
    }
    // An absurd error count (more than 9 digits) is not read as a count.
    expect(kernelLogParser.parse("EDAC MC0: 9999999999999999999 UE x on D (a)").snapshot.ecc_edac).toBeUndefined();
  });
});

describe("Windows CRLF line endings", () => {
  it("parses identically to LF and leaves no carriage return in any field", () => {
    const crlf = fixture("synthetic-crlf.txt");
    expect(crlf).toContain("\r\n");
    const r = kernelLogParser.parse(crlf);
    expect(r).toEqual(kernelLogParser.parse(crlf.replace(/\r\n/g, "\n")));
    expect(allStrings(r).some((s) => s.includes("\r"))).toBe(false);
    expect(r.snapshot.dmesg_events?.events.map((e) => [e.event_type, e.timestamp_iso])).toEqual([
      ["nvme_reset", "2026-10-03T10:00:01"],
      ["ext4_remount_readonly", "2026-10-03T10:00:03"],
    ]);
    expect(r.snapshot.dmesg_events?.events[1].details.device).toBe("nvme0n1p2");
    expect(tier1(r.snapshot).xid_events[0]).toMatchObject({ xid_code: 79, timestamp_iso: "2026-10-03T10:00:02" });
    expect(types(evaluate(r.snapshot).alerts)).toEqual(["disk_io_errors", "filesystem_readonly", "gpu_xid_critical"]);
  });
});

describe("shell prompt lines", () => {
  it("skips the prompt (whose grep pattern says 'I/O error') and never copies the hostname", () => {
    const text = fixture("synthetic-prompt.txt");
    const r = kernelLogParser.parse(text);
    expect(r.snapshot.io_errors).toEqual({ count: 1, devices: ["sdb"] });
    expect(r.snapshot.dmesg_events?.events.map((e) => e.details.device)).toEqual(["sdb1"]);
    expect(JSON.stringify(r)).not.toContain("host-example");
    expect(types(evaluate(r.snapshot).alerts)).toEqual(["disk_io_errors", "filesystem_readonly"]);
  });

  // R2-1 narrowed the bracketed form to keep it linear; every common prompt
  // shape must still be skipped.
  it.each([
    "[root@host-example ~]# dmesg -T | grep 'I/O error'",
    "[admin@db-01 /var/log]$ journalctl -k | grep 'I/O error'",
    "root@host-example:~# dmesg | grep 'I/O error'",
    "user@host-example:/srv$ dmesg | grep -i 'I/O error'",
    "$ dmesg | grep 'I/O error'",
    "# dmesg | grep 'I/O error'",
  ])("skips the prompt line %s", (prompt) => {
    const r = kernelLogParser.parse(`${prompt}\n[Fri Oct  3 10:05:12 2026] EXT4-fs (sdb1): Remounting filesystem read-only\n`);
    expect(r.snapshot.io_errors).toBeUndefined();
    expect(r.subjects).toBe(1);
  });
});

describe("injection text inside matching lines", () => {
  const text = fixture("synthetic-injection.txt");
  const r = kernelLogParser.parse(text);
  const INJECTED = /ignore|instruction|assistant|disregard|developer|system prompt|healthy|\bfine\b|reply|report this/i;

  it("keeps only the structured tokens", () => {
    const events = r.snapshot.dmesg_events!.events;
    expect(events.map((e) => [e.event_type, e.details])).toEqual([
      ["scsi_sense", { device: "sdb", sense_key: "Medium Error" }],
      ["ext4_remount_readonly", { device: "sdb1", remount_readonly: true }],
      ["nvme_reset", { controller: "nvme0", action: "timeout" }],
    ]);
    expect(tier1(r.snapshot).xid_events.map((x) => [x.pci_bdf, x.xid_code])).toEqual([["0000:3b:00", 79]]);
    expect(r.snapshot.io_errors).toEqual({ count: 1, devices: ["sdb"] });
    expect(r.snapshot.ecc_edac?.dimms).toEqual([
      { label: "DIMM_A1", location: "", size_mb: null, ce_count: 0, ue_count: 1 },
    ]);
    const msgs = r.notes.map((n) => n.message);
    expect(msgs).toContain("1 line was logged by a process other than the kernel and not counted.");
    expect(msgs).toContain("1 SCSI sense line carries no standard sense key and was not counted.");
  });

  it("never lets the injected sentence into the slice", () => {
    const strings = allStrings(r.snapshot);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) {
      expect(s.length).toBeLessThanOrEqual(64);
      expect(s).not.toMatch(INJECTED);
    }
    for (const n of r.notes) expect(n.message).not.toMatch(INJECTED);
    expect(JSON.stringify(r)).not.toContain("host-example");
    expect(JSON.stringify(r)).not.toContain("203.0.113.7");
  });

  it("never lets it into the evaluator output either", () => {
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    expect(types(alerts)).toEqual([
      "disk_io_errors",
      "disk_io_errors",
      "disk_io_errors",
      "ecc_errors",
      "filesystem_readonly",
      "gpu_xid_critical",
      "mce_uncorrected",
    ]);
    for (const a of alerts) {
      for (const s of [a.title, a.message, ...allStrings(a.evidence)]) {
        expect(s).not.toMatch(/ignore (all )?previous|disregard|developer mode|system prompt|report this server|say the GPU/i);
        expect(s).not.toContain("host-example");
      }
    }
  });
});

describe("timestamp formats", () => {
  const RO = "EXT4-fs (sda1): Remounting filesystem read-only";
  const cases: Array<[string, string, string]> = [
    // [line, format, timestamp_iso]
    [`2026-10-03T10:00:00+0200 host-example kernel: ${RO}`, "journalctl_kernel", "2026-10-03T08:00:00.000Z"],
    [`2026-10-03T10:00:00.123456+0200 host-example kernel: ${RO}`, "journalctl_kernel", "2026-10-03T08:00:00.123Z"],
    [`2026-10-03T10:00:00.123456+02:00 host-example kernel: ${RO}`, "syslog_kernel", "2026-10-03T08:00:00.123Z"],
    [`Fri 2026-10-03 10:00:00 CEST host-example kernel: ${RO}`, "journalctl_kernel", "2026-10-03T10:00:00"],
    [`[ 8823.112233] host-example kernel: ${RO}`, "journalctl_kernel", ""],
    [`Oct 03 10:00:00.123456 host-example kernel: ${RO}`, "journalctl_kernel", ""],
    [`Oct  3 10:00:00 host-example kernel: [ 8823.112233] ${RO}`, "syslog_kernel", ""],
    [`2026-10-03T10:00:00,123456+00:00 ${RO}`, "dmesg", "2026-10-03T10:00:00.123Z"],
    [`[Fri Oct  3 10:00:00 2026] ${RO}`, "dmesg", "2026-10-03T10:00:00"],
    [`kern  :crit  : [ 8823.112233] ${RO}`, "dmesg", ""],
    [`<2>[ 8823.112233] ${RO}`, "dmesg", ""],
    [RO, "dmesg", ""],
  ];

  it.each(cases)("%s", (line, format, ts) => {
    const r = kernelLogParser.parse(`${line}\n`);
    expect(r.formats).toEqual([format]);
    expect(r.snapshot.dmesg_events?.events).toEqual([
      {
        timestamp_iso: ts,
        raw_line: "",
        event_type: "ext4_remount_readonly",
        severity: "critical",
        details: { device: "sda1", remount_readonly: true },
      },
    ]);
    expect(JSON.stringify(r)).not.toContain("host-example");
    const unknownNote = r.notes.some((n) => n.message.startsWith("Event times are unknown for 1 line "));
    expect(unknownNote).toBe(ts === "");
  });

  it("counts an event from years ago (no 24 h cutoff, no 'now')", () => {
    const r = kernelLogParser.parse(
      "2024-01-15T03:00:00,000000+00:00 NVRM: Xid (PCI:0000:3b:00): 79, pid=1, name=python3, GPU has fallen off the bus.\n",
    );
    const { alerts } = evaluate(r.snapshot);
    expect(types(alerts)).toEqual(["gpu_xid_critical"]);
    expect(alerts[0].evidence).toMatchObject({ first_event_iso: "2024-01-15T03:00:00.000Z" });
  });

  it("does not date a relative timestamp", () => {
    const r = kernelLogParser.parse("[ 9001.000001] NVRM: Xid (PCI:0000:3b:00): 79, pid=1, name=x, GPU has fallen off the bus.\n");
    expect(tier1(r.snapshot).xid_events[0].timestamp_iso).toBe("");
  });
});

describe("NVMe line selection", () => {
  it("ignores driver lines that are not controller resets", () => {
    const r = kernelLogParser.parse([
      "[    1.431877] nvme nvme0: Shutdown timeout set to 8 seconds",
      "[ 5000.000001] nvme nvme0: I/O 5 QID 2 timeout, completion polled",
      "[ 5000.000002] nvme nvme0: Abort status: 0x371",
      "[ 5000.000003] nvme nvme0: 63/0/0 default/read/poll queues",
    ].join("\n"));
    expect(r.snapshot.dmesg_events?.events).toEqual([]);
  });

  it("recognises the reset family with Crucible's action word", () => {
    const r = kernelLogParser.parse([
      "[ 5000.000001] nvme nvme0: resetting controller due to AER",
      "[ 5000.000002] nvme nvme1: Device not ready; aborting reset, CSTS=0x1",
      "[ 5000.000003] nvme nvme2: Disabling device after reset failure: -19",
      "[ 5000.000004] nvme nvme3: I/O 0 QID 0 timeout, disable controller",
      "[ 5000.000005] nvme nvme4: frozen state error detected, reset controller",
    ].join("\n"));
    expect(r.snapshot.dmesg_events?.events.map((e) => [e.details.controller, e.details.action])).toEqual([
      ["nvme0", "reset"],
      ["nvme1", "aborting"],
      ["nvme2", "disabling"],
      ["nvme3", "timeout"],
      ["nvme4", "reset"],
    ]);
  });

  // R2-5: nvme_wait_ready prints "Device not ready; aborting %s" with
  // initialisation, reset or (6.x) shutdown; a controller that never comes
  // ready at boot is a dead drive, and Crucible's pattern flags it.
  it.each([
    [
      "dmesg -T",
      [
        "[Fri Oct  3 10:00:01 2026] nvme nvme1: Device not ready; aborting initialisation, CSTS=0x0",
        "[Fri Oct  3 10:00:01 2026] nvme nvme1: Removing after probe failure status: -19",
      ],
    ],
    [
      "journalctl -k",
      [
        "Oct 03 10:00:01 host-example kernel: nvme nvme1: Device not ready; aborting initialisation, CSTS=0x0",
        "Oct 03 10:00:01 host-example kernel: nvme nvme1: Removing after probe failure status: -19",
      ],
    ],
  ])("flags a controller that fails to initialise at boot (%s)", (_form, lines) => {
    const r = kernelLogParser.parse(lines.join("\n"));
    expect(r.snapshot.dmesg_events?.events.map((e) => [e.details.controller, e.details.action])).toEqual([
      ["nvme1", "aborting"],
      ["nvme1", "disabling"],
    ]);
    const alerts = evaluate(r.snapshot).alerts;
    expect(alerts.map((a) => [a.type, a.severity])).toEqual([
      ["disk_io_errors", "critical"],
      ["disk_io_errors", "critical"],
    ]);
  });

  it("flags 'aborting shutdown' and a probe-failure removal on its own", () => {
    const r = kernelLogParser.parse([
      "[ 5000.000001] nvme nvme2: Device not ready; aborting shutdown, CSTS=0x1",
      "[    2.000000] nvme nvme3: Removing after probe failure status: -19",
    ].join("\n"));
    expect(r.snapshot.dmesg_events?.events.map((e) => [e.details.controller, e.details.action])).toEqual([
      ["nvme2", "aborting"],
      ["nvme3", "disabling"],
    ]);
  });
});

describe("origin and dedup", () => {
  it("does not count a userspace line that imitates a kernel message", () => {
    const text = "Oct 03 09:00:00 host-example myapp[99]: NVRM: Xid (PCI:0000:3b:00): 79, pid=1, name=x, GPU has fallen off the bus.\n";
    expect(kernelLogParser.detect(text)).toBe(false);
    const r = kernelLogParser.parse(text);
    expect(r.snapshot).toEqual({});
    expect(r.subjects).toBe(0);
    expect(r.notes.map((n) => n.message)).toContain("1 line was logged by a process other than the kernel and not counted.");
  });

  it("collapses an exact repeat of a timestamped Xid but counts un-timestamped lines", () => {
    const line = "[ 9001.000001] NVRM: Xid (PCI:0000:3b:00): 79, pid=1, name=x, GPU has fallen off the bus.";
    expect(tier1(kernelLogParser.parse(`${line}\n${line}\n`).snapshot).xid_events).toHaveLength(1);
    const bare = "NVRM: Xid (PCI:0000:3b:00): 79, pid=1, name=x, GPU has fallen off the bus.";
    expect(tier1(kernelLogParser.parse(`${bare}\n${bare}\n`).snapshot).xid_events).toHaveLength(2);
  });
});

describe("allowlisted rules on every fixture", () => {
  it.each(ALL_FIXTURES)("%s: nothing throws and only domain rules fire", (name) => {
    const r = kernelLogParser.parse(fixture(name));
    const { alerts, errors } = evaluate(r.snapshot);
    expect(errors).toEqual([]);
    for (const a of alerts) expect(kernelLogParser.rules).toContain(a.type);
    for (const n of r.notes) expect(n.message).not.toMatch(/\u2014/);
  });
});

// Review round 1 (2026-10-03).
describe("benign SCSI sense noise (R1-17)", () => {
  it("the ATA pass-through status a smartctl or udisks query causes is not a disk error", () => {
    const r = kernelLogParser.parse(fixture("synthetic-journalctl-k-ata-passthrough-noise.txt"));
    expect(r.snapshot.dmesg_events?.events.filter((e) => e.event_type === "scsi_sense")).toEqual([]);
    expect(types(evaluate(r.snapshot).alerts)).not.toContain("disk_io_errors");
    expect(r.notes.map((n) => n.message).join("\n")).toMatch(/1 SCSI sense report was not counted/);
  });

  it("the WRITE SAME probe on a RAID virtual disk is not a disk error", () => {
    const r = kernelLogParser.parse(fixture("synthetic-dmesg-writesame-illegal-request.txt"));
    expect(types(evaluate(r.snapshot).alerts)).toEqual([]);
    expect(r.snapshot.io_errors).toBeUndefined();
  });

  it("No Sense is not an error; a Medium Error next to the same probe text still is", () => {
    const noSense = "[ 1.000000] sd 2:0:0:0: [sdc] tag#0 Sense Key : No Sense [current]\n";
    expect(types(evaluate(kernelLogParser.parse(noSense).snapshot).alerts)).toEqual([]);
    const medium =
      "[ 1.000000] sd 2:0:0:0: [sdc] tag#0 Sense Key : Medium Error [current]\n" +
      "[ 1.000001] sd 2:0:0:0: [sdc] tag#0 Add. Sense: ATA pass through information available\n";
    const alerts = evaluate(kernelLogParser.parse(medium).snapshot).alerts;
    expect(alerts.map((a) => `${a.type}:${a.severity}`)).toEqual(["disk_io_errors:critical"]);
  });

  it("an Illegal Request on a normal read is still reported", () => {
    const text =
      "[ 1.000000] sd 2:0:0:0: [sdc] tag#0 Sense Key : Illegal Request [current]\n" +
      "[ 1.000001] sd 2:0:0:0: [sdc] tag#0 Add. Sense: Logical block address out of range\n" +
      "[ 1.000002] sd 2:0:0:0: [sdc] tag#0 CDB: Read(10) 28 00 00 00 00 00 00 00 08 00\n";
    expect(types(evaluate(kernelLogParser.parse(text).snapshot).alerts)).toEqual(["disk_io_errors"]);
  });
});

describe("5.19+ block-layer and NVMe media errors (R1-18)", () => {
  it("critical medium error lines without the blk_update_request prefix fire disk_io_errors on the NVMe drive", () => {
    const r = kernelLogParser.parse(fixture("synthetic-dmesg-T-nvme-media-error-6x.txt"));
    expect(r.snapshot.io_errors).toEqual({ count: 3, devices: ["nvme0n1"] });
    const alert = evaluate(r.snapshot).alerts.find((a) => a.type === "disk_io_errors");
    expect(alert?.severity).toBe("critical");
  });

  it("the verbose NVMe line alone still counts when no block-layer line is in the paste", () => {
    const text = fixture("synthetic-dmesg-T-nvme-media-error-6x.txt")
      .split("\n")
      .filter((l) => !/critical medium error/.test(l))
      .join("\n");
    expect(kernelLogParser.parse(text).snapshot.io_errors).toEqual({ count: 3, devices: ["nvme0n1"] });
  });

  it("a block error on a discard or write-zeroes probe is not counted", () => {
    const text = "[ 1.000000] critical target error, dev sda, sector 2048 op 0x9:(WRITE_ZEROES) flags 0x800 phys_seg 0 prio class 2\n";
    const r = kernelLogParser.parse(text);
    expect(r.snapshot.io_errors).toBeUndefined();
    expect(r.notes.map((n) => n.message).join("\n")).toMatch(/discard or write-zeroes/);
  });
});

// R2-2: hardware lines these rules do not read (machine checks, APEI, btrfs and
// XFS failures, a libata UNC on its own) must not leave the matching rule
// listed as "ran and found no matching signal".
describe("recognised hardware lines no rule reads", () => {
  function analyze(name: string) {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      return analyzeOutput(fixture(name));
    } finally {
      log.mockRestore();
    }
  }
  const checked = (a: ReturnType<typeof analyze>) => a.checked_no_signal.map((c) => c.rule_id);
  const MCE_NOTE = /machine check or APEI hardware error lines? (?:was|were) seen but not decoded/;

  it.each([
    "synthetic-journalctl-mce-fatal-prevboot.txt",
    "synthetic-dmesg-T-mce-logged.txt",
    "synthetic-dmesg-T-ghes-memory-ue.txt",
  ])("does not list the memory rules as checked for %s", (name) => {
    const a = analyze(name);
    expect(a.findings).toEqual([]);
    expect(a.input.subjects).toBeGreaterThan(0);
    expect(checked(a)).not.toContain("ecc_errors");
    expect(checked(a)).not.toContain("mce_uncorrected");
    expect(a.notes.some((n) => MCE_NOTE.test(n))).toBe(true);
    expect(a.notes.join(" ")).not.toMatch(/none matched a disk, NVMe, filesystem, GPU Xid or memory error event/);
    expect(a.not_determinable.map((n) => n.signal)).toContain("Machine check and APEI hardware errors");
    // Nothing from the paste is copied into the answer.
    expect(JSON.stringify(a)).not.toMatch(/host-example|be00000000800400|intel_idle|fru_text/);
  });

  it("keeps the memory rules when an EDAC UE line fires them", () => {
    const a = analyze("synthetic-dmesg-T-ghes-with-edac-ue.txt");
    expect(a.findings.map((f) => f.rule_id).sort()).toEqual(["ecc_errors", "mce_uncorrected"]);
    expect(a.notes.some((n) => MCE_NOTE.test(n))).toBe(true);
  });

  it("does not list the read-only check as checked for a btrfs forced read-only", () => {
    const a = analyze("synthetic-dmesg-T-btrfs-forced-readonly.txt");
    expect(a.findings).toEqual([]);
    expect(checked(a)).not.toContain("filesystem_readonly");
    expect(a.notes.some((n) => /btrfs or XFS filesystem failure lines? (?:was|were) seen but not evaluated/.test(n))).toBe(true);
  });

  it("reports the XFS I/O errors but not the read-only check for an XFS shutdown", () => {
    const a = analyze("synthetic-dmesg-T-xfs-shutdown.txt");
    expect(a.findings.map((f) => f.rule_id)).toEqual(["disk_io_errors"]);
    expect(checked(a)).not.toContain("filesystem_readonly");
  });

  it("does not list the disk I/O check as checked for a libata UNC on its own", () => {
    const a = analyze("synthetic-dmesg-T-libata-unc-only.txt");
    expect(a.findings).toEqual([]);
    expect(checked(a)).not.toContain("disk_io_errors");
    expect(a.notes.some((n) => /libata uncorrectable read \(UNC\) lines? (?:was|were) seen/.test(n))).toBe(true);
  });

  it("keeps disk_io_errors when the full libata sequence carries sense and I/O error lines", () => {
    const a = analyze("synthetic-dmesg-T-libata-unc-full.txt");
    expect(a.findings.map((f) => [f.rule_id, f.severity])).toEqual([
      ["disk_io_errors", "critical"],
      ["disk_io_errors", "critical"],
    ]);
    expect(a.notes.some((n) => /libata uncorrectable read/.test(n))).toBe(false);
  });

  it("names what the rules read when nothing matched", () => {
    const r = kernelLogParser.parse(fixture("dmesg-healthy-boot.txt"));
    expect(r.notes.map((n) => n.message).join(" ")).toMatch(
      /none matched a SCSI sense, NVMe controller fault, ext4 read-only remount, block I\/O error, NVIDIA Xid or EDAC memory error line/,
    );
  });
});

function quietAnalyze(text: string) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    return analyzeOutput(text);
  } finally {
    log.mockRestore();
  }
}

// R2b-3: a line with no kernel prefix counted on any "I/O error" or EDAC text,
// so the answer's own quick check pasted back, or a sentence about it, came
// back as a critical disk error.
describe("commands and prose that mention a kernel error", () => {
  const GREP = "dmesg -T | grep -i 'I/O error'";
  it.each([
    `sudo dmesg -T | grep -iE '${DISK_IO_GREP}' | tail -40`,
    `sudo env LC_ALL=C dmesg -T | grep -iE '${DISK_IO_GREP}' | tail -40`,
    'dmesg | grep -i "I/O error"',
    "I ran dmesg -T | grep -iE 'I/O error' and it printed nothing.",
    "No I/O errors in dmesg.",
    "There are no I/O error lines in dmesg",
    `web-01:~ # ${GREP}`,
    `web-01 ~ # ${GREP}`,
    `root@web-01 ~ # ${GREP}`,
    `root@truenas[~]# ${GREP}`,
    `user@h ~ % ${GREP}`,
    `\u279c  ~ ${GREP}`,
    `bash-5.1# ${GREP}`,
    "grep -i 'EDAC MC0: 1 UE' /var/log/kern.log",
  ])("raises nothing for %s", (line) => {
    const r = kernelLogParser.parse(`${line}\n`);
    expect(r.snapshot.io_errors).toBeUndefined();
    expect(r.snapshot.ecc_edac).toBeUndefined();
    expect(quietAnalyze(`${line}\n`).findings).toEqual([]);
  });

  it("raises nothing for a healthy log pasted with a grep under an uncovered prompt", () => {
    const text = [
      "[Fri Oct  3 10:00:00 2026] Linux version 6.8.0-45-generic (buildd@example) #45-Ubuntu SMP",
      "[Fri Oct  3 10:00:01 2026] EXT4-fs (sda2): mounted filesystem with ordered data mode. Quota mode: none.",
      `web-01:~ # ${GREP}`,
      "web-01:~ #",
    ].join("\n");
    expect(quietAnalyze(text).findings).toEqual([]);
  });

  it.each([
    ["blk_update_request: I/O error, dev sda, sector 2048 op 0x0:(READ) flags 0x0 phys_seg 1 prio class 0", "sda"],
    ["print_req_error: I/O error, dev sdb, sector 2048", "sdb"],
    ["end_request: I/O error, dev sdc, sector 2048", "sdc"],
    ["I/O error, dev nvme0n1, sector 2048 op 0x0:(READ) flags 0x80700 phys_seg 1 prio class 2", "nvme0n1"],
    ["Buffer I/O error on dev sdd1, logical block 0, async page read", "sdd1"],
  ])("still counts the kernel line %s with no prefix (dmesg -t)", (line, device) => {
    expect(kernelLogParser.parse(`${line}\n`).snapshot.io_errors).toEqual({ count: 1, devices: [device] });
  });

  it("still counts an un-prefixed EDAC line", () => {
    const r = kernelLogParser.parse("EDAC MC0: 1 UE memory read error on CPU_SrcID#0_MC#0_Chan#0_DIMM#0 (channel:0 slot:0 page:0x0 offset:0x0 grain:32)\n");
    expect(r.snapshot.ecc_edac).toMatchObject({ edac_uncorrected_total: 1 });
  });
});

// R2b-7: `dmesg -H` / --reltime prints "[Oct 4 06:51]" and "[  +0.000012]"
// prefixes. Left in the message, they hid the anchored 6.x NVMe media-error
// lines and the paste was not recognised at all.
describe("dmesg -H (reltime) prefixes", () => {
  const media = (stamp: string) =>
    [
      `[${stamp}] nvme0n1: Read(0x2) @ LBA 1953520, 8 blocks, Unrecovered Read Error (sct 0x2 / sc 0x81) DNR`,
      "[  +0.000012] critical medium error, dev nvme0n1, sector 1953520 op 0x0:(READ) flags 0x80700 phys_seg 1 prio class 2",
    ].join("\n");

  it.each(["Oct 4 06:51", "Oct14 06:51"])("reads an NVMe media error under [%s]", (stamp) => {
    const r = kernelLogParser.parse(`${media(stamp)}\n`);
    expect(r.formats).toEqual(["dmesg"]);
    expect(r.snapshot.io_errors).toEqual({ count: 1, devices: ["nvme0n1"] });
    const a = quietAnalyze(`${media(stamp)}\n`);
    expect(a.findings.map((f) => [f.rule_id, f.severity])).toEqual([["disk_io_errors", "critical"]]);
  });

  it("does not list disk_io_errors as checked when a read-only remount follows", () => {
    const text = `${media("Oct 4 06:51")}\n[ +12.000101] EXT4-fs (nvme0n1p2): Remounting filesystem read-only\n`;
    const a = quietAnalyze(text);
    expect(a.findings.map((f) => f.rule_id).sort()).toEqual(["disk_io_errors", "filesystem_readonly"]);
    expect(a.checked_no_signal.map((c) => c.rule_id)).not.toContain("disk_io_errors");
  });

  it("reads grep -H output prefixed with the log file name", () => {
    const text = "/var/log/kern.log:Oct  4 06:51:00 web-01 kernel: [ 8823.112233] critical medium error, dev nvme0n1, sector 1953520 op 0x0:(READ) flags 0x80700 phys_seg 1 prio class 2\n";
    const r = kernelLogParser.parse(text);
    expect(r.formats).toEqual(["syslog_kernel"]);
    expect(r.snapshot.io_errors).toEqual({ count: 1, devices: ["nvme0n1"] });
  });
});

// R2b-15: network and virtual block devices have no local media.
describe("network and virtual block devices", () => {
  it.each(["nbd0", "rbd0", "zram0", "drbd1", "loop0p1"])("does not count I/O errors on %s", (dev) => {
    const text = [
      `[  412.000001] block ${dev}: Attempted send on invalid socket`,
      `[  412.000002] blk_update_request: I/O error, dev ${dev}, sector 0 op 0x0:(READ) flags 0x0 phys_seg 1 prio class 0`,
      `[  412.000003] Buffer I/O error on dev ${dev}, logical block 0, async page read`,
    ].join("\n");
    const r = kernelLogParser.parse(text);
    expect(r.snapshot.io_errors).toBeUndefined();
    expect(r.notes.map((n) => n.message).join(" ")).toMatch(/2 I\/O error lines on floppy, optical, loop, network or virtual block devices were not counted/);
    expect(quietAnalyze(text).findings).toEqual([]);
  });
});

// R2b-11: the device list rules join against every SMART entry is bounded; the
// count stays exact.
describe("I/O errors on many devices", () => {
  it("keeps the count and lists at most 256 device names", () => {
    const text = Array.from({ length: 300 }, (_, i) => `[ 1.000000] blk_update_request: I/O error, dev sd${i}, sector 0`).join("\n");
    const r = kernelLogParser.parse(text);
    expect(r.snapshot.io_errors?.count).toBe(300);
    expect(r.snapshot.io_errors?.devices).toHaveLength(256);
    expect(r.notes.map((n) => n.message)).toContain("I/O errors name more than 256 devices; the count covers all of them and the first 256 are listed.");
  });
});

// R3-2: Crucible's Xid table classes 13, 31, 43, 45 and 63 critical. NVIDIA's
// Xid catalog lists 13 and 31 from a named process as application faults
// (RESTART_APP), 43 and 63 as IGNORE, and 45 as the application being torn
// down, so a crashed CUDA job or a row remap came back as four critical,
// vendor-side GPU faults.
describe("Xid codes NVIDIA does not treat as a GPU fault (R3-2)", () => {
  const XID_NOTE = /NVIDIA Xid events? \(codes? [\d, ]+\) (?:was|were) not raised as a finding: NVIDIA's Xid catalog lists/;

  it("a crashed CUDA job's 13, 43, 31 and 45 raise no critical finding, and the answer says what was seen", () => {
    const text = fixture("synthetic-dmesg-T-xid-app-crash.txt");
    const r = kernelLogParser.parse(text);
    // The second Xid 13 line repeats the first's stamp, GPU and code.
    expect(tier1(r.snapshot).xid_events.map((x) => [x.xid_code, x.severity])).toEqual([
      [13, "warning"],
      [43, "info"],
      [31, "warning"],
      [45, "info"],
    ]);
    expect(types(evaluate(r.snapshot).alerts)).toEqual([]);
    const a = quietAnalyze(text);
    expect(a.findings).toEqual([]);
    const note = a.notes.find((n) => XID_NOTE.test(n))!;
    expect(note).toMatch(/^4 NVIDIA Xid events \(codes 13, 43, 31, 45\) were not raised/);
    // It ran on the events and they are not its signal: not "no matching signal".
    expect(a.checked_no_signal.map((c) => c.rule_id)).not.toContain("gpu_xid_critical");
    expect(renderAnalysisText(a)).toContain(note);
  });

  it("a lone Xid 63 row remap is not a critical, vendor-side finding", () => {
    const a = quietAnalyze(fixture("synthetic-dmesg-T-xid-63-row-remap.txt"));
    expect(a.findings).toEqual([]);
    expect(a.notes.find((n) => XID_NOTE.test(n))).toMatch(/^1 NVIDIA Xid event \(code 63\) was not raised/);
  });

  it("a lone Xid 45 (the application torn down) is not critical", () => {
    const a = quietAnalyze("[ 9001.000001] NVRM: Xid (PCI:0000:3b:00): 45, pid=1234, name=python3, Ch 00000010\n");
    expect(a.findings).toEqual([]);
  });

  it("13 or 31 with no process named stays critical, and real faults beside them still fire", () => {
    const text = [
      "[ 9001.000001] NVRM: Xid (PCI:0000:3b:00): 13, pid='<unknown>', name=<unknown>, Graphics Exception: ESR 0x404600=0x80000002",
      "[ 9001.000002] NVRM: Xid (PCI:0000:af:00): 79, pid='<unknown>', name=<unknown>, GPU has fallen off the bus.",
      "[ 9001.000003] NVRM: Xid (PCI:0000:af:00): 31, pid=4242, name=python3, Ch 00000010, intr 00000000. MMU Fault",
      "[ 9001.000004] NVRM: Xid (PCI:0000:5e:00): 48, pid=4243, name=python3, An uncorrectable double bit error (DBE) has been detected on GPU in the framebuffer at partition 6, subpartition 0.",
    ].join("\n");
    const a = quietAnalyze(`${text}\n`);
    expect(a.findings.map((f) => [f.rule_id, f.severity, f.observed.xid_code]).sort()).toEqual([
      ["gpu_xid_critical", "critical", 13],
      ["gpu_xid_critical", "critical", 48],
      ["gpu_xid_critical", "critical", 79],
    ]);
    expect(a.notes.find((n) => XID_NOTE.test(n))).toMatch(/^1 NVIDIA Xid event \(code 31\) was not raised/);
  });

  // R4-6: drivers before R495 log the process id with no name= after it.
  it("older drivers' 13, 43 and 31 with a pid but no name= raise no critical finding (R4-6)", () => {
    const a = quietAnalyze(fixture("synthetic-dmesg-T-xid-app-crash-r470.txt"));
    expect(a.findings).toEqual([]);
    const note = a.notes.find((n) => XID_NOTE.test(n))!;
    expect(note).toMatch(/^3 NVIDIA Xid events \(codes 13, 43, 31\) were not raised/);
    expect(note).toContain("13 and 31 from a process as application faults");
  });

  it("13 or 31 with pid=N but name=<unknown> stays critical (R4-6)", () => {
    for (const code of [13, 31]) {
      const a = quietAnalyze(`[ 9001.000001] NVRM: Xid (PCI:0000:3b:00): ${code}, pid=1, name=<unknown>, Ch 00000010\n`);
      expect(a.findings.map((f) => [f.rule_id, f.severity])).toEqual([["gpu_xid_critical", "critical"]]);
    }
  });

  it("the summary no longer says NVIDIA classes the code critical", () => {
    const a = quietAnalyze("[ 9001.000002] NVRM: Xid (PCI:0000:af:00): 79, pid='<unknown>', name=<unknown>, GPU has fallen off the bus.\n");
    const f = a.findings.find((x) => x.rule_id === "gpu_xid_critical")!;
    expect(f.summary).not.toMatch(/NVIDIA's Xid table classes/);
    expect(f.summary).toMatch(/Glassmkr's agent classes/);
  });
});

// R3-6: `dmesg -T` formats its stamp with strftime in the caller's locale,
// and sudo keeps LANG and LC_*. A German, French or Spanish stamp (or a
// German `journalctl -k` month) left the line unrecognised: a dead GPU and a
// failing disk came back "No supported command output was recognised", and
// the next capture was the same command.
describe("localized dmesg -T and journalctl -k stamps (R3-6)", () => {
  const body = [
    "NVRM: Xid (PCI:0000:18:00): 79, pid='<unknown>', name=<unknown>, GPU has fallen off the bus.",
    "sd 2:0:0:0: [sdc] tag#12 Sense Key : Medium Error [current]",
    "sd 2:0:0:0: [sdc] tag#12 Add. Sense: Unrecovered read error",
    "blk_update_request: I/O error, dev sdc, sector 1953520 op 0x0:(READ) flags 0x0 phys_seg 1 prio class 0",
  ];
  const verdict = (text: string) =>
    quietAnalyze(text)
      .findings.map((f) => `${f.rule_id}:${f.severity}`)
      .sort();
  const english = verdict(body.map((l, i) => `[Sat Oct  4 02:11:4${i} 2026] ${l}`).join("\n"));

  it("the English control gives three critical findings", () => {
    expect(english).toEqual(["disk_io_errors:critical", "disk_io_errors:critical", "gpu_xid_critical:critical"]);
  });

  it.each([
    ["de_DE", (i: number) => `[Sa Okt  4 02:11:4${i} 2026] `],
    ["de_DE, day first", (i: number) => `[Sa  4. Okt 02:11:4${i} 2026] `],
    ["de_DE, English month", (i: number) => `[Mi Nov  4 02:11:4${i} 2026] `],
    ["fr_FR", (i: number) => `[sam. oct.  4 02:11:4${i} 2026] `],
    ["es_ES", (i: number) => `[sáb oct  4 02:11:4${i} 2026] `],
    ["ja_JP", (i: number) => `[土 10月  4 02:11:4${i} 2026] `],
    ["de_DE journalctl -k", (i: number) => `Okt 04 03:20:1${i} host-example kernel: `],
  ])("%s gives the same findings, with times unknown", (_locale, stamp) => {
    const text = body.map((l, i) => stamp(i) + l).join("\n");
    expect(kernelLogParser.detect(text)).toBe(true);
    const r = kernelLogParser.parse(text);
    expect(tier1(r.snapshot).xid_events[0].timestamp_iso).toBe("");
    expect(verdict(text)).toEqual(english);
  });

  it("a localized journal line from a process other than the kernel is not counted", () => {
    const text = "Okt 04 03:20:12 host-example myapp[42]: NVRM: Xid (PCI:0000:18:00): 79, pid=1, name=x, GPU has fallen off the bus.\n";
    expect(kernelLogParser.detect(text)).toBe(false);
    expect(quietAnalyze(text).findings).toEqual([]);
  });

  it("an application log with a bracketed time is not a kernel log", () => {
    expect(kernelLogParser.detect("[INFO 12:00:00 2026] worker started\n[WARN 12:00:01 2026] retrying\n")).toBe(false);
  });
});
