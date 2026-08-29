import { describe, it, expect } from "vitest";
import { normalizeVendor } from "../vendor";

describe("normalizeVendor: canonical mapping", () => {
  it("collapses Gigabyte variants to GIGABYTE", () => {
    expect(normalizeVendor("GIGABYTE")).toBe("GIGABYTE");
    expect(normalizeVendor("Gigabyte Technology Co., Ltd.")).toBe("GIGABYTE");
    expect(normalizeVendor("Gigabyte")).toBe("GIGABYTE");
  });

  it("collapses Supermicro variants to Supermicro", () => {
    expect(normalizeVendor("Supermicro Inc.")).toBe("Supermicro");
    expect(normalizeVendor("Super Micro Computer, Inc.")).toBe("Supermicro");
    expect(normalizeVendor("SUPERMICRO")).toBe("Supermicro");
  });

  it("collapses ASRockRack variants to ASRockRack", () => {
    expect(normalizeVendor("ASRockRack")).toBe("ASRockRack");
    expect(normalizeVendor("ASRock Rack")).toBe("ASRockRack");
  });

  it("collapses ASUS variants to ASUS", () => {
    expect(normalizeVendor("ASUS")).toBe("ASUS");
    expect(normalizeVendor("ASUSTeK COMPUTER INC.")).toBe("ASUS");
  });

  it("collapses Dell variants to Dell", () => {
    expect(normalizeVendor("Dell Inc.")).toBe("Dell");
    expect(normalizeVendor("Dell")).toBe("Dell");
  });

  it("collapses HP/HPE variants to HPE", () => {
    expect(normalizeVendor("HP")).toBe("HPE");
    expect(normalizeVendor("HPE")).toBe("HPE");
    expect(normalizeVendor("Hewlett Packard Enterprise")).toBe("HPE");
  });

  it("collapses Lenovo variants to Lenovo", () => {
    expect(normalizeVendor("Lenovo")).toBe("Lenovo");
    expect(normalizeVendor("LENOVO")).toBe("Lenovo");
  });

  it("collapses Inspur variants to Inspur", () => {
    expect(normalizeVendor("Inspur")).toBe("Inspur");
    expect(normalizeVendor("Inspur Electronic Information Industry Co., Ltd.")).toBe("Inspur");
  });
});

describe("normalizeVendor: empty / null / whitespace handling", () => {
  it("returns empty string for null", () => {
    expect(normalizeVendor(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(normalizeVendor(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(normalizeVendor("")).toBe("");
  });

  it("returns empty string for whitespace-only", () => {
    expect(normalizeVendor("   ")).toBe("");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(normalizeVendor("  Dell Inc.  ")).toBe("Dell");
  });
});

describe("normalizeVendor: VM / unknown vendors", () => {
  it("displays QEMU verbatim", () => {
    expect(normalizeVendor("QEMU")).toBe("QEMU");
  });

  it("strips trailing ', Inc.' on VMware", () => {
    expect(normalizeVendor("VMware, Inc.")).toBe("VMware");
  });

  it("preserves an unrecognised vendor with no suffix", () => {
    expect(normalizeVendor("Acme Boards")).toBe("Acme Boards");
  });

  it("strips trailing ' Ltd.' on a generic vendor", () => {
    expect(normalizeVendor("Foobar Ltd.")).toBe("Foobar");
  });
});
