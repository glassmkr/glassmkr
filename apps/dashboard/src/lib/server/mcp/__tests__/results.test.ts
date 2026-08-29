import { describe, expect, it } from "vitest";
import { createMcpResult } from "../results.js";

describe("MCP result boundary", () => {
  it("labels untrusted fields outside the product data", () => {
    const result = createMcpResult(
      { server: { hostname: "worker-1" } },
      "mixed",
      ["/data/server/hostname"],
    );
    expect(result.content[0].text).toContain("TRUST: mixed data.");
    expect(result.structuredContent).toMatchObject({
      data: { server: { hostname: "worker-1" } },
      meta: {
        trust: {
          classification: "mixed",
          untrusted_json_pointers: ["/data/server/hostname"],
        },
      },
    });
  });

  it("neutralizes control and bidirectional characters in host strings", () => {
    const result = createMcpResult(
      { hostname: "safe\u0000\u202Etxt" },
      "untrusted_host_data",
      ["/data/hostname"],
    );
    const hostname = (result.structuredContent.data as Record<string, unknown>).hostname;
    expect(hostname).toBe("safe��txt");
    expect(result.content[0].text).not.toContain("\u202E");
  });

  it("normalizes dates before structured output validation", () => {
    const result = createMcpResult(
      { observed_at: new Date("2026-07-18T12:34:56.000Z") },
      "untrusted_host_data",
      ["/data/observed_at"],
    );
    expect((result.structuredContent.data as Record<string, unknown>).observed_at)
      .toBe("2026-07-18T12:34:56.000Z");
  });

  it("rejects an unbounded array", () => {
    expect(() => createMcpResult(
      { points: Array.from({ length: 2001 }, (_, index) => index) },
      "untrusted_host_data",
      ["/data/points"],
    )).toThrow("too many items");
  });
});
