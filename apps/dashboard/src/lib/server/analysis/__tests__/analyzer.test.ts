import { describe, it, expect } from "vitest";
import { parseLlmResponse, buildAnalysisPrompt, sanitizeFindings } from "../analyzer";
import type { AnalysisResult } from "../analyzer";

describe("parseLlmResponse", () => {
  const happy = {
    summary: "All good.",
    findings: [{ category: "cpu", title: "CPU idle", detail: "ok", severity: "info" }],
    recommendations: [],
    risk_level: "healthy",
  };

  it("parses a plain JSON response", () => {
    const result = parseLlmResponse(JSON.stringify(happy));
    expect(result.summary).toBe("All good.");
    expect(result.risk_level).toBe("healthy");
  });

  it("strips markdown fences", () => {
    const fenced = "```json\n" + JSON.stringify(happy) + "\n```";
    expect(parseLlmResponse(fenced).risk_level).toBe("healthy");
  });

  it("throws on non-JSON content", () => {
    expect(() => parseLlmResponse("I am a language model, not JSON.")).toThrow(/non-JSON/);
  });

  it("throws on missing summary", () => {
    const bad = { ...happy, summary: undefined };
    expect(() => parseLlmResponse(JSON.stringify(bad))).toThrow(/summary/);
  });

  it("throws on invalid risk_level", () => {
    const bad = { ...happy, risk_level: "explodey" };
    expect(() => parseLlmResponse(JSON.stringify(bad))).toThrow(/risk_level/);
  });

  it("throws on missing findings array", () => {
    const bad = { ...happy, findings: undefined };
    expect(() => parseLlmResponse(JSON.stringify(bad))).toThrow(/findings/);
  });

  it("defaults recommendations and optimizations to empty arrays when absent", () => {
    const bare = { summary: "ok", findings: [], risk_level: "healthy" };
    const result = parseLlmResponse(JSON.stringify(bare));
    expect(result.recommendations).toEqual([]);
    expect(result.optimizations).toEqual([]);
  });

  it("parses optimizations array when present", () => {
    const full = { ...happy, optimizations: ["Server is underutilized. Consider consolidation."] };
    const result = parseLlmResponse(JSON.stringify(full));
    expect(result.optimizations).toEqual(["Server is underutilized. Consider consolidation."]);
  });
});

describe("buildAnalysisPrompt", () => {
  const snap = { cpu_user_percent: 10, cpu_system_percent: 3, cpu_iowait_percent: 1, load_1m: 0.5, ram_used_mb: 4096, ram_total_mb: 16384, swap_used_mb: 0, disks: [], smart: [], network: [], ipmi: { available: false } };

  it("embeds the server name and current snapshot", () => {
    const prompt = buildAnalysisPrompt(snap, null, [], "test-1");
    expect(prompt).toContain('"test-1"');
    expect(prompt).toContain("Current snapshot");
    expect(prompt).not.toContain("Previous snapshot");
  });

  it("appends a previous snapshot block when provided", () => {
    const prompt = buildAnalysisPrompt(snap, snap, [], "test-1");
    expect(prompt).toContain("Previous snapshot");
  });

  it("lists active alerts with their alert_type for grounding", () => {
    const prompt = buildAnalysisPrompt(snap, null, [
      { alert_type: "ram_high", severity: "critical", title: "RAM high", message: "at 96%" },
    ], "test-1");
    expect(prompt).toContain("Active alerts");
    expect(prompt).toContain("RAM high");
    expect(prompt).toContain("[critical]");
    expect(prompt).toContain("alert_type=ram_high");
  });

  it("appends the trend-warning block only when warnings are present", () => {
    const bare = buildAnalysisPrompt(snap, null, [], "test-1");
    expect(bare).not.toContain("trend warnings");
    const withTw = buildAnalysisPrompt(snap, null, [], "test-1", {
      trendWarnings: [{ warning_type: "smart_187_growing", urgency_tier: "soon" }],
    });
    expect(withTw).toContain("Active trend warnings");
    expect(withTw).toContain("smart_187_growing");
  });

  it("appends the 7-day alert-history block only when present", () => {
    const bare = buildAnalysisPrompt(snap, null, [], "test-1");
    expect(bare).not.toContain("Alert history");
    const withHist = buildAnalysisPrompt(snap, null, [], "test-1", {
      alertHistory: [{ alert_type: "disk_latency_high", fired_7d: 42 }],
    });
    expect(withHist).toContain("Alert history");
    expect(withHist).toContain("disk_latency_high");
    expect(withHist).toContain("42");
  });
});

describe("sanitizeFindings", () => {
  const base = (): AnalysisResult => ({
    summary: "s",
    findings: [
      { category: "cpu", title: "t", detail: "d", severity: "warning", urgency: "scheduled" },
    ],
    recommendations: [],
    optimizations: [],
    risk_level: "warning",
    generated_at: "2026-07-03T00:00:00.000Z",
  });

  it("strips any command/action a finding carries despite the prompt", () => {
    const r = base();
    const bag = r.findings[0] as unknown as Record<string, unknown>;
    bag.command = "rm -rf /";
    bag.action = "sudo reboot";
    sanitizeFindings(r, []);
    expect(bag.command).toBeUndefined();
    expect(bag.action).toBeUndefined();
  });

  it("keeps a related_alert_type that matches an active alert", () => {
    const r = base();
    r.findings[0].related_alert_type = "ram_high";
    sanitizeFindings(r, [{ alert_type: "ram_high", severity: "critical", title: "x", message: "y" }]);
    expect(r.findings[0].related_alert_type).toBe("ram_high");
  });

  it("nulls a related_alert_type that is not in the active set", () => {
    const r = base();
    r.findings[0].related_alert_type = "ghost_alert";
    sanitizeFindings(r, [{ alert_type: "ram_high", severity: "critical", title: "x", message: "y" }]);
    expect(r.findings[0].related_alert_type).toBeNull();
  });
});
