import { describe, it, expect } from "vitest";
import { parsePciBdf, pciBdfMatches } from "../pci-bdf";

// Real shapes. nvidia-smi `pci.bus_id` (what Crucible stores as
// tier1.gpus[].pci_bdf): "00000000:63:00.0", 8-digit domain, uppercase hex,
// function suffix (8x H200 NVL box, nvidia-smi, 2026-09-16). The NVRM Xid
// line Crucible copies into xid_events[].pci_bdf: "0000:63:00" from
// "NVRM: Xid (PCI:0000:63:00): 74, NVLink: fatal error ..." on the same box,
// 4-digit domain, lowercase hex, no function.

describe("parsePciBdf", () => {
  it("parses the nvidia-smi form", () => {
    expect(parsePciBdf("00000000:E6:00.0")).toEqual({ domain: 0, bus: 0xe6, device: 0, fn: 0 });
  });

  it("parses the NVRM Xid form, which has no function", () => {
    expect(parsePciBdf("0000:e6:00")).toEqual({ domain: 0, bus: 0xe6, device: 0, fn: null });
  });

  it("keeps a non-zero domain as its numeric value", () => {
    expect(parsePciBdf("00000001:3B:00.0")?.domain).toBe(1);
    expect(parsePciBdf("0001:3b:00")?.domain).toBe(1);
  });

  it("returns null for strings that are not a domain-qualified PCI address", () => {
    expect(parsePciBdf("")).toBeNull();
    expect(parsePciBdf("unknown")).toBeNull();
    expect(parsePciBdf("3b:00.0")).toBeNull();
    expect(parsePciBdf("0000:3b:00.0 extra")).toBeNull();
  });
});

describe("pciBdfMatches: nvidia-smi vs NVRM Xid", () => {
  it("matches the same GPU across both sources (H200 NVL buses)", () => {
    expect(pciBdfMatches("00000000:63:00.0", "0000:63:00")).toBe(true);
    expect(pciBdfMatches("00000000:64:00.0", "0000:64:00")).toBe(true);
  });

  it("ignores hex case (nvidia-smi uppercase, kernel lowercase)", () => {
    expect(pciBdfMatches("00000000:E6:00.0", "0000:e6:00")).toBe(true);
    expect(pciBdfMatches("00000000:3B:00.0", "0000:3b:00")).toBe(true);
  });

  it("is symmetric", () => {
    expect(pciBdfMatches("0000:e6:00", "00000000:E6:00.0")).toBe(true);
  });

  it("matches identical strings from one source", () => {
    expect(pciBdfMatches("00000000:63:00.0", "00000000:63:00.0")).toBe(true);
    expect(pciBdfMatches("0000:63:00", "0000:63:00")).toBe(true);
  });

  it("does not match a different bus", () => {
    expect(pciBdfMatches("00000000:64:00.0", "0000:63:00")).toBe(false);
    expect(pciBdfMatches("00000000:E7:00.0", "0000:e6:00")).toBe(false);
  });

  it("does not match a different domain", () => {
    expect(pciBdfMatches("00000001:63:00.0", "0000:63:00")).toBe(false);
    expect(pciBdfMatches("00000000:63:00.0", "0001:63:00")).toBe(false);
  });

  it("does not match a different device", () => {
    expect(pciBdfMatches("00000000:63:01.0", "0000:63:00")).toBe(false);
  });

  it("compares the function only when both sides carry one", () => {
    expect(pciBdfMatches("00000000:63:00.0", "0000:63:00.1")).toBe(false);
    expect(pciBdfMatches("00000000:63:00.1", "0000:63:00")).toBe(true);
  });

  it("never matches an unparseable side, even against itself", () => {
    expect(pciBdfMatches("unknown", "unknown")).toBe(false);
    expect(pciBdfMatches("", "0000:63:00")).toBe(false);
  });
});
