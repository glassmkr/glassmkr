// Tests for evaluateUnexpectedRebootDecay — the pure decision function the
// ingest path uses to decide whether a stale unexpected_reboot alert
// should auto-resolve. The DB UPDATE itself happens in the ingest path
// (apps/dashboard/src/routes/api/v1/ingest/+server.ts); this file covers
// the decision logic only, which is all the rule-shape edge cases live in.
//
// Six cases mirror the spec in
// ~/Documents/Glassmkr/CC_FORGE_HYGIENE_WORKSTREAM_B.md section A.1.

import { describe, it, expect } from "vitest";

import {
  evaluateUnexpectedRebootDecay,
  UNEXPECTED_REBOOT_DECAY_HOURS_DEFAULT,
} from "../evaluator";

const HOUR_SECONDS = 3600;

describe("evaluateUnexpectedRebootDecay", () => {
  it("does not resolve when uptime is below the default threshold", () => {
    // Case 1: alert active, uptime < 24h → stays active.
    const decision = evaluateUnexpectedRebootDecay(12 * HOUR_SECONDS, {});
    expect(decision.shouldResolve).toBe(false);
    expect(decision.decay_hours_used).toBe(UNEXPECTED_REBOOT_DECAY_HOURS_DEFAULT);
    expect(decision.resolution_reason).toBeUndefined();
  });

  it("resolves when uptime crosses the default threshold", () => {
    // Case 2: alert active, uptime >= 24h → auto-resolves with reason.
    const decision = evaluateUnexpectedRebootDecay(25 * HOUR_SECONDS, {});
    expect(decision.shouldResolve).toBe(true);
    expect(decision.decay_hours_used).toBe(24);
    expect(decision.resolution_reason).toBe("auto_decay_stable_24h");
  });

  it("respects a per-server override of 48 hours (stays active at 25h)", () => {
    // Case 3a: override 48h, uptime 25h → still active.
    const decision = evaluateUnexpectedRebootDecay(25 * HOUR_SECONDS, {
      unexpected_reboot_decay_hours: 48,
    });
    expect(decision.shouldResolve).toBe(false);
    expect(decision.decay_hours_used).toBe(48);
  });

  it("respects a per-server override of 48 hours (resolves at 49h)", () => {
    // Case 3b: override 48h, uptime 49h → resolves with reason naming 48h.
    const decision = evaluateUnexpectedRebootDecay(49 * HOUR_SECONDS, {
      unexpected_reboot_decay_hours: 48,
    });
    expect(decision.shouldResolve).toBe(true);
    expect(decision.decay_hours_used).toBe(48);
    expect(decision.resolution_reason).toBe("auto_decay_stable_48h");
  });

  it("respects a per-server override of 1 hour (resolves at 2h uptime)", () => {
    // Case 4: noisy-fleet operator tunes the threshold way down.
    const decision = evaluateUnexpectedRebootDecay(2 * HOUR_SECONDS, {
      unexpected_reboot_decay_hours: 1,
    });
    expect(decision.shouldResolve).toBe(true);
    expect(decision.decay_hours_used).toBe(1);
    expect(decision.resolution_reason).toBe("auto_decay_stable_1h");
  });

  it("does not resolve at very low uptime (new reboot during active alert)", () => {
    // Case 5: a new reboot happens while the existing alert is still
    // active — uptime drops near zero. Decay must not resolve in that
    // window; the existing short-circuit in evaluateUnexpectedReboot
    // still suppresses a double-fire.
    const decision = evaluateUnexpectedRebootDecay(60, {});
    expect(decision.shouldResolve).toBe(false);
  });

  it("ignores invalid override values and falls back to the default", () => {
    // Case 6: defensive — malformed config_overrides shouldn't crash
    // or silently use a bad value. Strings, negatives, zero, NaN, null
    // all fall back to the 24h default. (The new-reboot-after-decay
    // case from the spec is structurally identical to case 1 once the
    // prior alert is resolved, so we cover it via the malformed-input
    // robustness check here.)
    const cases: Array<{ unexpected_reboot_decay_hours: unknown }> = [
      { unexpected_reboot_decay_hours: "24" },
      { unexpected_reboot_decay_hours: -5 },
      { unexpected_reboot_decay_hours: 0 },
      { unexpected_reboot_decay_hours: Number.NaN },
      { unexpected_reboot_decay_hours: null },
    ];
    for (const overrides of cases) {
      const decision = evaluateUnexpectedRebootDecay(
        25 * HOUR_SECONDS,
        overrides as never,
      );
      expect(decision.decay_hours_used).toBe(UNEXPECTED_REBOOT_DECAY_HOURS_DEFAULT);
      expect(decision.shouldResolve).toBe(true);
      expect(decision.resolution_reason).toBe("auto_decay_stable_24h");
    }
  });

  it("treats null and undefined overrides as default", () => {
    expect(evaluateUnexpectedRebootDecay(25 * HOUR_SECONDS, null).shouldResolve).toBe(true);
    expect(evaluateUnexpectedRebootDecay(25 * HOUR_SECONDS, undefined).shouldResolve).toBe(true);
    expect(evaluateUnexpectedRebootDecay(12 * HOUR_SECONDS, null).shouldResolve).toBe(false);
  });
});
