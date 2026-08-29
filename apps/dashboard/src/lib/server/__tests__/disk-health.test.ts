import { describe, it, expect } from "vitest";
import { deriveDiskHealth, classifyTransition } from "../disk-health";

// Minimal SMART row builder. Any field Crucible doesn't populate stays
// undefined; matches the runtime shape.
function drive(overrides: Record<string, unknown> = {}): any {
  return { device: "/dev/sda", model: "TEST SSD", health: "PASSED", ...overrides };
}

describe("deriveDiskHealth: state derivation", () => {
  it("drive with no SMART issues is healthy", () => {
    const [d] = deriveDiskHealth([drive()], { count: 0, devices: [] });
    expect(d.state).toBe("healthy");
    expect(d.signals).toEqual([]);
  });

  it("power_on_hours > threshold only: declining", () => {
    const [d] = deriveDiskHealth([drive({ power_on_hours: 50_000 })], null);
    expect(d.state).toBe("declining");
    expect(d.signals).toContain("power_on_hours_high");
  });

  it("pending_sectors > 0 only: failing", () => {
    const [d] = deriveDiskHealth([drive({ pending_sectors: 1 })], null);
    expect(d.state).toBe("failing");
    expect(d.signals).toContain("pending_sectors_present");
  });

  it("reallocated_sectors > 0 only: failing (sticky, no trend required)", () => {
    const [d] = deriveDiskHealth([drive({ reallocated_sectors: 1 })], null);
    expect(d.state).toBe("failing");
    expect(d.signals).toContain("reallocated_sectors_present");
  });

  it("SMART overall health != PASSED: broken", () => {
    const [d] = deriveDiskHealth([drive({ health: "FAILED!" })], null);
    expect(d.state).toBe("broken");
    expect(d.signals).toContain("smart_overall_health_fail");
  });

  it("power_on_hours AND pending_sectors: failing (higher wins)", () => {
    const [d] = deriveDiskHealth(
      [drive({ power_on_hours: 50_000, pending_sectors: 1 })],
      null,
    );
    expect(d.state).toBe("failing");
    expect(d.signals).toEqual(expect.arrayContaining(["power_on_hours_high", "pending_sectors_present"]));
  });

  it("pending_sectors AND SMART FAIL: broken", () => {
    const [d] = deriveDiskHealth(
      [drive({ pending_sectors: 1, health: "FAILED!" })],
      null,
    );
    expect(d.state).toBe("broken");
  });

  it("NVMe percentage_used > 80 only: declining", () => {
    const [d] = deriveDiskHealth(
      [drive({ device: "/dev/nvme0n1", percentage_used: 85 })],
      null,
    );
    expect(d.state).toBe("declining");
    expect(d.signals).toContain("nvme_wear_high");
  });

  it("NVMe percentage_used at threshold (80) does not match", () => {
    const [d] = deriveDiskHealth(
      [drive({ device: "/dev/nvme0n1", percentage_used: 80 })],
      null,
    );
    expect(d.state).toBe("healthy");
  });

  it("kernel I/O errors for this device beat a PASSED SMART status (spec edge 23)", () => {
    const [d] = deriveDiskHealth(
      [drive({ device: "/dev/sda", health: "PASSED" })],
      { count: 5, devices: ["sda"] },
    );
    expect(d.state).toBe("broken");
    expect(d.signals).toContain("io_errors_in_dmesg");
  });

  it("kernel I/O errors for a different device do not affect this one", () => {
    const [d] = deriveDiskHealth(
      [drive({ device: "/dev/sda" })],
      { count: 5, devices: ["sdb"] },
    );
    expect(d.state).toBe("healthy");
  });

  it("unpopulated health field is treated as healthy, not broken", () => {
    const [d] = deriveDiskHealth([drive({ health: "" })], null);
    expect(d.state).toBe("healthy");
  });

  it("returns one entry per input drive, stable ordering", () => {
    const drives = [
      drive({ device: "/dev/sda" }),
      drive({ device: "/dev/sdb", pending_sectors: 1 }),
      drive({ device: "/dev/nvme0n1", percentage_used: 90 }),
    ];
    const out = deriveDiskHealth(drives, null);
    expect(out.map((d) => d.device_id)).toEqual(["/dev/sda", "/dev/sdb", "/dev/nvme0n1"]);
    expect(out.map((d) => d.state)).toEqual(["healthy", "failing", "declining"]);
  });

  it("returns empty array for undefined smart section", () => {
    expect(deriveDiskHealth(undefined, null)).toEqual([]);
  });

  it("drops entries with no device identifier", () => {
    const out = deriveDiskHealth([{ model: "x" }], null);
    expect(out).toEqual([]);
  });
});

describe("classifyTransition", () => {
  it("first observation as healthy: no transition event", () => {
    expect(classifyTransition(null, "healthy")).toBeNull();
  });

  it("first observation as declining: suppressed (too noisy per spec)", () => {
    expect(classifyTransition(null, "declining")).toBeNull();
  });

  it("first observation as failing: P3 fire", () => {
    expect(classifyTransition(null, "failing")).toEqual({ kind: "fire", priority: 3 });
  });

  it("first observation as broken: P1 fire", () => {
    expect(classifyTransition(null, "broken")).toEqual({ kind: "fire", priority: 1 });
  });

  it("declining -> failing: P3 fire", () => {
    expect(classifyTransition("declining", "failing")).toEqual({ kind: "fire", priority: 3 });
  });

  it("declining -> broken: P1 fire", () => {
    expect(classifyTransition("declining", "broken")).toEqual({ kind: "fire", priority: 1 });
  });

  it("failing -> broken: P1 fire", () => {
    expect(classifyTransition("failing", "broken")).toEqual({ kind: "fire", priority: 1 });
  });

  it("healthy -> declining: suppressed", () => {
    expect(classifyTransition("healthy", "declining")).toBeNull();
  });

  it("any -> healthy: resolution, not a fire", () => {
    expect(classifyTransition("failing", "healthy")).toEqual({ kind: "resolution" });
    expect(classifyTransition("broken", "healthy")).toEqual({ kind: "resolution" });
    expect(classifyTransition("declining", "healthy")).toEqual({ kind: "resolution" });
  });

  it("failing -> declining: informational (signal cleared, worth verifying)", () => {
    const t = classifyTransition("failing", "declining");
    expect(t?.kind).toBe("informational");
  });

  it("broken -> anything other than itself: informational (likely hardware swap)", () => {
    expect(classifyTransition("broken", "failing")?.kind).toBe("informational");
    expect(classifyTransition("broken", "declining")?.kind).toBe("informational");
  });

  it("same-state is not a transition", () => {
    for (const s of ["healthy", "declining", "failing", "broken"] as const) {
      expect(classifyTransition(s, s)).toBeNull();
    }
  });
});
