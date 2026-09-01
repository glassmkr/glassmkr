// C-6 (Grok + Codex security review, 2026-09-01). Open DCR must be OFF by
// default on a hosted (multi-tenant) deployment even when the base flag is set.

import { describe, it, expect } from "vitest";
import { dcrAllowed } from "../constants";

describe("dcrAllowed", () => {
  it("is off whenever the base flag is not set, regardless of deployment", () => {
    expect(dcrAllowed(false, false, false)).toBe(false);
    expect(dcrAllowed(false, true, true)).toBe(false);
  });

  it("HOSTED: base flag alone is NOT enough (default-closed)", () => {
    expect(dcrAllowed(true, /* selfHosted */ false, /* hostedOptIn */ false)).toBe(false);
  });

  it("HOSTED: requires the explicit MCP_DCR_ALLOW_HOSTED opt-in", () => {
    expect(dcrAllowed(true, false, true)).toBe(true);
  });

  it("SELF-HOSTED: the single base flag is sufficient (operator is the only tenant)", () => {
    expect(dcrAllowed(true, true, false)).toBe(true);
  });
});
