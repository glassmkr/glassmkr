// Codex 2026-05-22B F1 unit tests for getPriority + expandChannelPriorities.
// Pin the dispatcher-facing contract that a P0 alert is paging-grade and
// that existing customer channels (created before P0 existed) still
// receive it.

import { describe, it, expect } from "vitest";
import {
  ALERT_PRIORITIES,
  getPriority,
  expandChannelPriorities,
} from "../presentation";

describe("getPriority", () => {
  it("returns the literal map value for a known rule", () => {
    // gpu_uncorrected_ecc is P0 in the YAML registry.
    expect(getPriority("gpu_uncorrected_ecc")).toBe(0);
    // smart_failing is P1.
    expect(getPriority("smart_failing")).toBe(1);
    // cpu_high is P2.
    expect(getPriority("cpu_high")).toBe(2);
    // load_high is P3.
    expect(getPriority("load_high")).toBe(3);
  });

  it("defaults unknown alert types to P3", () => {
    expect(getPriority("rule_we_have_not_added_yet")).toBe(3);
  });

  it("bumps severity=critical one tier up, clamped at P0", () => {
    // P2 + critical -> P1
    expect(getPriority("cpu_high", "critical")).toBe(1);
    // P1 + critical -> P0 (new behaviour; previously stuck at P1).
    expect(getPriority("smart_failing", "critical")).toBe(0);
    // P0 + critical stays P0 (can't get more urgent than P0).
    expect(getPriority("gpu_uncorrected_ecc", "critical")).toBe(0);
    // P3 + critical -> P2.
    expect(getPriority("load_high", "critical")).toBe(2);
  });

  it("leaves priority unchanged when severity is absent/unknown", () => {
    // No usable severity signal -> fall back to the rule's base priority.
    expect(getPriority("smart_failing", undefined)).toBe(1);
    expect(getPriority("smart_failing", "weird")).toBe(1);
  });

  it("floors a warning instance at P2 (never paging-grade)", () => {
    // A P1 rule seen at warning severity is high, not urgent.
    expect(getPriority("smart_failing", "warning")).toBe(2);
    // A P0 rule at warning severity also floors at P2 (not P0/P1).
    expect(getPriority("gpu_uncorrected_ecc", "warning")).toBe(2);
    // Rules already at/under the floor are unchanged.
    expect(getPriority("cpu_high", "warning")).toBe(2); // P2 stays P2
    expect(getPriority("load_high", "warning")).toBe(3); // P3 stays P3
  });

  it("maps an info instance to P4, below the default notify threshold", () => {
    // Motivating bug: a clean, intentional reboot (severity=info) on the P1
    // unexpected_reboot rule must not read "P1 URGENT" or page. P4 is not in
    // the default channel priority set (P0..P3), so it shows without paging.
    expect(getPriority("unexpected_reboot", "info")).toBe(4);
    expect(getPriority("smart_failing", "info")).toBe(4);
    expect(getPriority("load_high", "info")).toBe(4);
    // "informational" is treated the same as "info".
    expect(getPriority("unexpected_reboot", "informational")).toBe(4);
  });
});

describe("expandChannelPriorities — Codex 2026-05-22B F1", () => {
  it("includes P0 when channel includes P1 but not P0", () => {
    expect(expandChannelPriorities(["P1", "P2", "P3", "P4"])).toEqual([
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
    ]);
  });

  it("is idempotent when channel already lists P0", () => {
    expect(expandChannelPriorities(["P0", "P1", "P2"])).toEqual([
      "P0",
      "P1",
      "P2",
    ]);
  });

  it("does NOT add P0 when channel has not opted into P1 either", () => {
    // A "low-priority-only" channel that the customer set up to receive
    // only P3 alerts shouldn't suddenly receive P0 pages.
    expect(expandChannelPriorities(["P3"])).toEqual(["P3"]);
    expect(expandChannelPriorities(["P2", "P3"])).toEqual(["P2", "P3"]);
  });

  it("preserves order so callers can reason about precedence", () => {
    const out = expandChannelPriorities(["P1", "P2"]);
    expect(out[0]).toBe("P0");
  });
});

describe("ALERT_PRIORITIES coverage smoke", () => {
  it("contains at least one P0 rule (the case that triggered this fix)", () => {
    const p0Rules = Object.entries(ALERT_PRIORITIES).filter(([, v]) => v === 0);
    expect(p0Rules.length).toBeGreaterThan(0);
  });

  it("maps the three known P0 rules from the YAML library", () => {
    expect(ALERT_PRIORITIES.gpu_uncorrected_ecc).toBe(0);
    expect(ALERT_PRIORITIES.gpu_xid_critical).toBe(0);
    expect(ALERT_PRIORITIES.mce_uncorrected).toBe(0);
  });
});
