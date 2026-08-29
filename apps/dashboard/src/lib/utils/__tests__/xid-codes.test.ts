// Tests for the XID code lookup table used by the GPU panel's event
// log and (transitively) by alert evidence rendering. The table
// mirrors Crucible v0.13.0's hardcoded severity classification; if
// the two ever drift, alert messages will say one thing and the
// panel another. The table is small enough that a handful of
// representative codes plus the unknown fallback give meaningful
// coverage.

import { describe, expect, it } from "vitest";

import { formatXid, xidSeverity, xidShortDescription } from "../xid-codes";

describe("xid-codes", () => {
  it("returns the canonical description for known critical codes", () => {
    expect(xidShortDescription(79)).toBe("GPU has fallen off the bus");
    expect(xidShortDescription(48)).toBe("Double Bit ECC error");
    expect(xidShortDescription(119)).toBe("GSP RPC timeout");
  });

  it("returns the canonical description for known warning codes", () => {
    expect(xidShortDescription(38)).toBe("Driver firmware error");
    expect(xidShortDescription(67)).toBe("NVLink error (recoverable)");
  });

  it("falls back to a generic string for unknown codes", () => {
    expect(xidShortDescription(9999)).toBe(
      "hardware fault (consult NVIDIA XID reference)",
    );
  });

  it("classifies severity correctly", () => {
    expect(xidSeverity(79)).toBe("critical");
    expect(xidSeverity(48)).toBe("critical");
    expect(xidSeverity(38)).toBe("warning");
    expect(xidSeverity(9999)).toBe("info");
  });

  it("formatXid combines code and description", () => {
    expect(formatXid(79)).toBe("XID 79: GPU has fallen off the bus");
    expect(formatXid(9999)).toBe(
      "XID 9999: hardware fault (consult NVIDIA XID reference)",
    );
  });
});
