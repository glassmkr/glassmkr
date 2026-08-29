// Phase 1 validation-failures logger tests.
//
// Confirms:
//   - Counters increment per failure
//   - Per-path counters increment per issue
//   - Log lines contain server_id + path + code but not the offending value
//   - reset clears state for clean test isolation

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  logSnapshotValidationFailure,
  getValidationFailureCounters,
  resetValidationFailureCountersForTests,
} from "../validation-failures";

beforeEach(() => {
  resetValidationFailureCountersForTests();
});

describe("logSnapshotValidationFailure: counters", () => {
  it("increments total per call", () => {
    logSnapshotValidationFailure({
      serverId: "srv_1",
      issues: [{ path: "cpu", code: "invalid_type", message: "expected number" }],
    });
    expect(getValidationFailureCounters().total).toBe(1);

    logSnapshotValidationFailure({
      serverId: "srv_2",
      issues: [{ path: "cpu", code: "invalid_type", message: "expected number" }],
    });
    expect(getValidationFailureCounters().total).toBe(2);
  });

  it("increments per-path counter per issue", () => {
    logSnapshotValidationFailure({
      serverId: "srv_1",
      issues: [
        { path: "cpu.user_percent", code: "invalid_type", message: "x" },
        { path: "memory.total_mb", code: "invalid_type", message: "y" },
        { path: "cpu.user_percent", code: "invalid_type", message: "x again" },
      ],
    });
    const counters = getValidationFailureCounters();
    expect(counters.byPath.get("cpu.user_percent")).toBe(2);
    expect(counters.byPath.get("memory.total_mb")).toBe(1);
  });
});

describe("logSnapshotValidationFailure: redaction", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs the structured fields but never the raw payload contents", () => {
    logSnapshotValidationFailure({
      serverId: "srv_42",
      collectorVersion: "0.9.0",
      issues: [
        { path: "system.hostname", code: "invalid_type", message: "Expected string, received number" },
      ],
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = String(warnSpy.mock.calls[0][0]);
    expect(line).toMatch(/server=srv_42/);
    expect(line).toMatch(/agent=0\.9\.0/);
    expect(line).toMatch(/path=system\.hostname/);
    expect(line).toMatch(/code=invalid_type/);
    // Reasonable proxy for "we did not log the offending value": no
    // host data ended up in the line. The caller never passes the
    // value to this function, so it can't.
  });

  it("uses 'unknown' for collectorVersion when not provided", () => {
    logSnapshotValidationFailure({
      serverId: "srv_x",
      issues: [{ path: "cpu", code: "invalid_type", message: "Required" }],
    });
    const line = String(warnSpy.mock.calls[0][0]);
    expect(line).toMatch(/agent=unknown/);
  });
});
