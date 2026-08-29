import { describe, it, expect } from "vitest";
import { baseDiskName, resolveFailedMembers } from "../raid-members";

describe("baseDiskName", () => {
  it("strips /dev/ and partition suffixes to the base disk", () => {
    expect(baseDiskName("/dev/sdb2")).toBe("sdb");
    expect(baseDiskName("sdb2")).toBe("sdb");
    expect(baseDiskName("/dev/sdb")).toBe("sdb");
    expect(baseDiskName("sda")).toBe("sda");
    expect(baseDiskName("vda1")).toBe("vda");
    expect(baseDiskName("xvda3")).toBe("xvda");
  });
  it("keeps the NVMe namespace but drops the partition", () => {
    expect(baseDiskName("/dev/nvme0n1p3")).toBe("nvme0n1");
    expect(baseDiskName("nvme0n1")).toBe("nvme0n1");
    expect(baseDiskName("nvme1n2p1")).toBe("nvme1n2");
  });
  it("returns null for empty or nullish input", () => {
    expect(baseDiskName(null)).toBeNull();
    expect(baseDiskName(undefined)).toBeNull();
    expect(baseDiskName("")).toBeNull();
    expect(baseDiskName("   ")).toBeNull();
  });
});

describe("resolveFailedMembers", () => {
  const smart = [
    { device: "/dev/sda", model: "Seagate Exos X18", serial: "ZR5AAA01" },
    { device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0" },
  ];

  it("resolves a partition member to the base disk's model + serial", () => {
    expect(resolveFailedMembers(["sdb2"], smart)).toEqual([
      { member: "sdb2", device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0" },
    ]);
  });

  it("resolves a whole-disk member too", () => {
    expect(resolveFailedMembers(["sda"], smart)).toEqual([
      { member: "sda", device: "/dev/sda", model: "Seagate Exos X18", serial: "ZR5AAA01" },
    ]);
  });

  it("keeps the member with null identity when the disk is gone from the SMART scan", () => {
    expect(resolveFailedMembers(["sdz1"], smart)).toEqual([
      { member: "sdz1", device: null, model: null, serial: null },
    ]);
  });

  it("handles empty / missing inputs without throwing", () => {
    expect(resolveFailedMembers([], smart)).toEqual([]);
    expect(resolveFailedMembers(undefined, undefined)).toEqual([]);
    expect(resolveFailedMembers(["sda"], undefined)).toEqual([
      { member: "sda", device: null, model: null, serial: null },
    ]);
  });
});
