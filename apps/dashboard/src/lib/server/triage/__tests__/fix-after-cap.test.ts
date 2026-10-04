// R4-15: every alert was shaped in full (resolveFix, fix text, the dedupe key)
// before the 30-finding cap, so a 200 KB zpool paste of faulted vdevs resolved
// about 9,000 fix workflows and threw all but 30 away: about 70 MB of
// allocation per anonymous call on the process that also serves ingest.

import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/alerts/fix-workflow/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/server/alerts/fix-workflow/resolve.js")>();
  return { ...actual, resolveFix: vi.fn(actual.resolveFix) };
});

import { resolveFix } from "$lib/server/alerts/fix-workflow/resolve.js";
import { analyzeOutput } from "../analyze";
import { roundFourInputs } from "./adversarial-inputs";

describe("fix workflows are resolved only for the findings the answer keeps (R4-15)", () => {
  it("thousands of faulted vdevs: at most one resolveFix per kept finding, same answer shape", () => {
    const text = roundFourInputs(200_000).find((i) => i.name === "zpool: thousands of faulted top-level vdevs")!.text;
    vi.mocked(resolveFix).mockClear();
    const a = analyzeOutput(text);
    expect(a.findings).toHaveLength(30);
    expect(vi.mocked(resolveFix).mock.calls.length).toBeLessThanOrEqual(a.findings.length);
    for (const f of a.findings) expect(f.fix?.quick_check?.command).toBeTruthy();
    expect(a.notes.some((n) => /^\d+ more findings were left out of this answer \(zfs_pool_unhealthy x\d+\)/.test(n))).toBe(true);
  });
});
