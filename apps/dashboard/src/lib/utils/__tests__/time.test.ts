import { describe, it, expect } from "vitest";
import { timeAgo } from "../time";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");

  it("renders a relative age for a real timestamp", () => {
    expect(timeAgo("2026-10-03T11:58:00Z", now)).toBe("2m ago");
    expect(timeAgo("2026-09-30T12:00:00Z", now)).toBe("3d ago");
  });

  // Crucible #151 sends "" for an XID (or SEL / dmesg) event whose kernel line
  // carried no absolute time. new Date("") is Invalid Date, which rendered as
  // "NaNd ago" in the GPU XID event log.
  it("renders 'time unknown' for an empty event time", () => {
    expect(timeAgo("", now)).toBe("time unknown");
  });

  it("renders 'time unknown' for an unparseable timestamp", () => {
    expect(timeAgo("[ 8312.441027]", now)).toBe("time unknown");
  });
});
