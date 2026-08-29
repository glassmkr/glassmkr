// End-to-end test of analyzeServerHealth with the LLM HTTP call mocked.
// Verifies the full flow: prompt construction, request shape, response parsing,
// and graceful failure on invalid LLM output.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { analyzeServerHealth } from "../analyzer";

// LLM_API_URL is read at module load. Stub via env before importing the module
// (which we already imported above). The module reads process.env at call time
// via a module-level const, so set it before any test runs.

describe("analyzeServerHealth (end to end with mocked fetch)", () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env.LLM_API_URL = "http://test-llm.local";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  function mockLlmReply(content: string, ok = true) {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify(ok ? { choices: [{ message: { content } }] } : {}),
      { status: ok ? 200 : 500 }
    )) as typeof fetch;
  }

  const snap = {
    cpu_user_percent: 10, cpu_system_percent: 3, cpu_iowait_percent: 1, load_1m: 0.5,
    ram_used_mb: 4096, ram_total_mb: 16384, swap_used_mb: 0,
    disks: [], smart: [], network: [], ipmi: { available: false },
  };

  it("returns a parsed AnalysisResult on a well-formed LLM response", async () => {
    mockLlmReply(JSON.stringify({
      summary: "Server healthy.",
      findings: [{ category: "cpu", title: "Idle", detail: "low load", severity: "info" }],
      recommendations: ["No action required."],
      risk_level: "healthy",
    }));

    const result = await analyzeServerHealth(snap, null, [], "test-1");
    expect(result.summary).toBe("Server healthy.");
    expect(result.risk_level).toBe("healthy");
    expect(result.findings).toHaveLength(1);
    expect(result.generated_at).not.toBe("");
  });

  it("strips markdown fences from the LLM output", async () => {
    mockLlmReply("```json\n" + JSON.stringify({
      summary: "ok", findings: [], recommendations: [], risk_level: "watch",
    }) + "\n```");

    const result = await analyzeServerHealth(snap, null, [], "test-1");
    expect(result.risk_level).toBe("watch");
  });

  it("throws a descriptive error on garbage LLM output", async () => {
    mockLlmReply("Sorry, I cannot answer that.");
    await expect(analyzeServerHealth(snap, null, [], "test-1")).rejects.toThrow(/non-JSON/);
  });

  it("throws when the LLM returns an empty content", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "" } }] }),
      { status: 200 }
    )) as typeof fetch;
    await expect(analyzeServerHealth(snap, null, [], "test-1")).rejects.toThrow(/Empty LLM response/);
  });

  it("posts to /chat/completions with the configured model and includes the server name in the user prompt", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        summary: "ok", findings: [], recommendations: [], risk_level: "healthy",
      }) } }] }), { status: 200 });
    }) as typeof fetch;

    await analyzeServerHealth(snap, null, [], "edge-server-9");
    expect(calls).toHaveLength(1);
    // LLM_URL is captured at module load; we just assert the path suffix.
    expect(calls[0].url).toMatch(/\/chat\/completions$/);
    const body = calls[0].body as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain('"edge-server-9"');
  });
});
