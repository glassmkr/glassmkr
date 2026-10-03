// The OpenAI plugin package (integrations/ai-assistants) describes this server
// to a reviewer: tool names, and review prompts with the result each must
// produce. Nothing tied the two together, so renaming a tool or changing a
// parser left every gate green while the package named a tool that no longer
// existed or promised a finding the server no longer returned (R1-35).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { analyzeOutput } from "../analyze";
import { TRIAGE_TOOL_NAMES } from "../mcp-server";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..", "..");
const PACKAGE = join(ROOT, "integrations", "ai-assistants");

interface ReviewCase {
  prompt: string;
  tools_triggered?: string;
  expected_behavior: string;
}

const plugin = JSON.parse(readFileSync(join(PACKAGE, "openai-plugin", "plugin.json"), "utf8"));
const cases: { positive: ReviewCase[]; negative: ReviewCase[] } = plugin.extensions["com.openai"].review.test_cases;

// What each analyze_server_output review prompt must produce. Every value
// here also has to appear in the case's expected_behavior text.
const EXPECTED: Record<string, { severity: string; id: string; serial?: string }> = {
  smart_failing: { severity: "critical", id: "/dev/sda", serial: "ZC1REVIEW1" },
  raid_degraded: { severity: "critical", id: "md0" },
  gpu_xid_critical: { severity: "critical", id: "0000:3b:00" },
};

describe("OpenAI plugin package matches the server", () => {
  it("the validator's tool list is the server's", () => {
    const source = readFileSync(join(PACKAGE, "scripts", "validate-openai-plugin.mjs"), "utf8");
    const list = /export const TOOL_NAMES = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...TRIAGE_TOOL_NAMES]);
  });

  it("every positive review case names a tool the server exposes", () => {
    for (const c of cases.positive) expect(TRIAGE_TOOL_NAMES).toContain(c.tools_triggered);
  });

  it("each analyze_server_output review prompt produces the finding its expected behavior describes", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const analyzed = cases.positive.filter((c) => c.tools_triggered === "analyze_server_output");
    expect(analyzed.length).toBe(Object.keys(EXPECTED).length);
    for (const c of analyzed) {
      const rule = Object.keys(EXPECTED).find((r) => c.expected_behavior.includes(r));
      expect(rule, c.expected_behavior).toBeDefined();
      const want = EXPECTED[rule!];
      expect(c.expected_behavior).toContain(want.severity);
      expect(c.expected_behavior).toContain(want.id);
      if (want.serial) expect(c.expected_behavior).toContain(want.serial);
      const finding = analyzeOutput(c.prompt).findings.find((f) => f.rule_id === rule);
      expect(finding, rule).toBeDefined();
      expect(finding!.severity).toBe(want.severity);
      expect(finding!.subject.id).toBe(want.id);
      if (want.serial) expect(finding!.subject.serial).toBe(want.serial);
    }
    vi.restoreAllMocks();
  });

  it("the out-of-scope Windows paste is recognised as nothing, as its case says", () => {
    const windows = cases.negative.find((c) => /Windows Event Viewer/.test(c.prompt));
    expect(windows).toBeDefined();
    const a = analyzeOutput(windows!.prompt);
    expect(a.input.formats).toEqual([]);
    expect(a.findings).toEqual([]);
  });
});
