import { describe, expect, it } from "vitest";
import { validateNarration, templateFallback, parseLlmNarration } from "../narration";
import type { Finding, Narration } from "../types";

function findingForDrive(): Finding {
  return {
    type: "smart_5_growing",
    severity: "high",
    resource: { kind: "drive", name: "/dev/sda", serial: "ZCH0ABCD", model: "ST12000NM0007", vendor: "Seagate" },
    contributing_metrics: [
      { name: "smart_5_raw", current: 14, baseline: 0, delta_1d: 0, delta_7d: 3, delta_30d: 14, burst_max_7d: 0, window: "30d" },
    ],
    correlation_match: "smart_plus_zfs",
    tree_ranker_score: null,
    projected_timeline: "within 14-30 days",
    evidence_summary: "SMART 5 growing",
  };
}

function goodNarration(): Narration {
  return {
    headline: "SMART reallocated sectors growing on /dev/sda",
    evidence_summary: "SMART 5 raw is 14, up by 3 in 7 days and 14 in 30 days. Pattern matches drive pre-failure.",
    uncertainty_statement: "This does not establish imminent failure. Verify with smartctl before acting.",
    recommended_checks: ["smartctl -a /dev/sda", "zpool status -v"],
    recommended_actions: ["Schedule proactive replacement within 2 weeks"],
  };
}

describe("validateNarration", () => {
  it("passes a grounded narration", () => {
    const r = validateNarration(goodNarration(), findingForDrive());
    expect(r.valid).toBe(true);
  });

  it("rejects invented numbers", () => {
    const n = goodNarration();
    n.evidence_summary = "SMART 5 raw is 999 which is not in the evidence";
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not grounded/);
  });

  it("rejects invented drive serials", () => {
    const n = goodNarration();
    n.evidence_summary = "Drive FAKEFAKESERIALZZZ is failing";
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/invented/);
  });

  it("rejects causal language when no correlation matched", () => {
    const finding = findingForDrive();
    finding.correlation_match = null;
    const n = goodNarration();
    n.evidence_summary = "The issue is caused by bad firmware";
    const r = validateNarration(n, finding);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/causal/);
  });

  it("allows causal language when correlation matched", () => {
    const n = goodNarration();
    n.evidence_summary = "SMART 5 raw is 14; issue is consistent with pre-failure due to pattern match";
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(true);
  });

  it("rejects absolute-claim language", () => {
    const n = goodNarration();
    n.evidence_summary = "This drive will fail within 14 days";
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/absolute/);
  });

  it("rejects when recommended_checks is empty", () => {
    const n = goodNarration();
    n.recommended_checks = [];
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(false);
  });

  it("rejects when recommended_actions is empty", () => {
    const n = goodNarration();
    n.recommended_actions = [];
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(false);
  });

  it("accepts small common integers not in evidence", () => {
    const n = goodNarration();
    n.uncertainty_statement = "Within 7 days there is risk. Run 2 checks.";
    const r = validateNarration(n, findingForDrive());
    expect(r.valid).toBe(true);
  });
});

describe("parseLlmNarration", () => {
  it("strips code fences and parses", () => {
    const wrapped = "```json\n" + JSON.stringify(goodNarration()) + "\n```";
    const n = parseLlmNarration(wrapped);
    expect(n.headline).toBe(goodNarration().headline);
  });

  it("throws on missing fields", () => {
    expect(() => parseLlmNarration(JSON.stringify({ headline: "x" }))).toThrow();
  });
});

describe("templateFallback", () => {
  it("produces a valid fallback narration", () => {
    const n = templateFallback(findingForDrive(), "test-host");
    expect(n.headline.length).toBeGreaterThan(0);
    expect(n.recommended_checks.length).toBeGreaterThan(0);
    expect(n.recommended_actions.length).toBeGreaterThan(0);
    const v = validateNarration(n, findingForDrive());
    expect(v.valid).toBe(true);
  });

  it("tailors checks for NVMe", () => {
    const finding = findingForDrive();
    finding.resource.kind = "nvme";
    finding.resource.name = "/dev/nvme0n1";
    finding.type = "nvme_critical_warning";
    const n = templateFallback(finding, "test-host");
    expect(n.recommended_checks.some(c => c.includes("nvme"))).toBe(true);
  });

  it("tailors checks for disk fill", () => {
    const finding = findingForDrive();
    finding.resource.kind = "partition";
    finding.resource.name = "/";
    finding.type = "disk_fill_imminent";
    const n = templateFallback(finding, "test-host");
    expect(n.recommended_checks.some(c => c.startsWith("df"))).toBe(true);
  });
});
