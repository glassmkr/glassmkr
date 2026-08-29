import { describe, it, expect } from "vitest";
import { extractMissingDrives, type TwSnapshotRow } from "../features.js";
import { missingDriveTriggers } from "../triggers.js";
import type { ServerFeatures } from "../types.js";

const MIN_5 = 5 * 60 * 1000;

// Build a timeline of snapshots. `smartAt(i)` returns the SMART array present
// in snapshot i, so a drive can be dropped partway through.
function rows(count: number, smartAt: (i: number) => unknown[]): TwSnapshotRow[] {
  const base = 1_700_000_000_000;
  const out: TwSnapshotRow[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      timestamp: base + i * MIN_5,
      smart: JSON.stringify(smartAt(i)),
      disks: "[]", ipmi: "{}", network: "{}", zfs: "{}",
    } as TwSnapshotRow);
  }
  return out;
}

const DISK_A = { device: "/dev/sda", serial: "SNA123", model: "Samsung SSD 870" };
const DISK_B = { device: "/dev/sdb", serial: "SNB456", model: "WDC WD40" };

describe("extractMissingDrives", () => {
  it("flags a serial'd drive that was a fixture and then vanished while the host kept reporting", () => {
    // 40 snapshots (~3.3h). B present for the first 30, gone for the last 10.
    const r = rows(40, (i) => (i < 30 ? [DISK_A, DISK_B] : [DISK_A]));
    const missing = extractMissingDrives(r);
    expect(missing).toHaveLength(1);
    expect(missing[0].serial).toBe("SNB456");
    expect(missing[0].device).toBe("/dev/sdb");
    expect(missing[0].missing_for_minutes).toBeGreaterThanOrEqual(20);
    expect(missing[0].host_snapshots_since).toBe(10);
  });

  it("does NOT flag when the whole host goes quiet (both drives vanish together)", () => {
    // Every snapshot has both drives; the host simply stops after 40. There is
    // no per-drive gap relative to the host's own last-seen -> nothing.
    const r = rows(40, () => [DISK_A, DISK_B]);
    expect(extractMissingDrives(r)).toHaveLength(0);
  });

  it("does NOT flag a brief blip (drive present too briefly to be a fixture)", () => {
    // B appears only in snapshots 2-4 then never again: under the observation
    // and present-span floors.
    const r = rows(40, (i) => (i >= 2 && i <= 4 ? [DISK_A, DISK_B] : [DISK_A]));
    const missing = extractMissingDrives(r);
    expect(missing.find((m) => m.serial === "SNB456")).toBeUndefined();
  });

  it("does NOT flag a drive still present in the latest snapshot", () => {
    const r = rows(40, () => [DISK_A, DISK_B]);
    expect(extractMissingDrives(r).find((m) => m.serial === "SNA123")).toBeUndefined();
  });

  it("ignores serial-less drives (cannot be tracked without FP risk)", () => {
    const noSerial = { device: "/dev/sdc", model: "Generic" };
    const r = rows(40, (i) => (i < 30 ? [DISK_A, noSerial] : [DISK_A]));
    expect(extractMissingDrives(r)).toHaveLength(0);
  });

  it("does NOT flag when the host barely reported after the drive vanished (< 2 snapshots since)", () => {
    // B present through snapshot 38; host has only snapshot 39 after -> 1 since.
    const r = rows(40, (i) => (i <= 38 ? [DISK_A, DISK_B] : [DISK_A]));
    expect(extractMissingDrives(r).find((m) => m.serial === "SNB456")).toBeUndefined();
  });

  it("does NOT flag a still-enumerating drive that only lost its serial (transient smartctl failure)", () => {
    // /dev/sdb is present in ALL 40 snapshots, but reports its serial only for
    // the first 30. From snapshot 30 on the serial is dropped while device +
    // model keep reporting (a transient smartctl read failure). The serial's
    // last-seen stalls, but the device path is still enumerating, so this is
    // NOT a de-enumeration and must not fire.
    const DISK_B_NO_SERIAL = { device: "/dev/sdb", model: "WDC WD40" };
    const r = rows(40, (i) => (i < 30 ? [DISK_A, DISK_B] : [DISK_A, DISK_B_NO_SERIAL]));
    const missing = extractMissingDrives(r);
    expect(missing.find((m) => m.serial === "SNB456")).toBeUndefined();
  });
});

describe("missingDriveTriggers", () => {
  it("emits a medium drive_disappeared finding from missing_drives", () => {
    const features = {
      server_id: "srv_1",
      hostname: "web-01",
      missing_drives: [{
        device: "/dev/sdb", serial: "SNB456", model: "WDC WD40", vendor: "WDC",
        observations: 30, present_span_hours: 2.5, missing_for_minutes: 50, host_snapshots_since: 10,
      }],
    } as unknown as ServerFeatures;
    const findings = missingDriveTriggers(features);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("drive_disappeared");
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].resource).toMatchObject({ kind: "drive", serial: "SNB456" });
    expect(findings[0].evidence_summary).toContain("invisible to the RAID and SMART rules");
  });

  it("emits nothing when there are no missing drives", () => {
    expect(missingDriveTriggers({ missing_drives: [] } as unknown as ServerFeatures)).toHaveLength(0);
    expect(missingDriveTriggers({} as unknown as ServerFeatures)).toHaveLength(0);
  });
});
