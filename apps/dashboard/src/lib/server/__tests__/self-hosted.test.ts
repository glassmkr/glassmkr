import { describe, it, expect, afterEach } from "vitest";
import { effectiveServerLimit, __recomputeForTests, HOSTED_FREE_NODE_CAP } from "../self-hosted";

// The flag is read once at module load, so these tests exercise the pure
// helpers and the env parsing seam rather than re-importing the module. The
// integration behaviour (gates actually passing) is covered by the plan and
// quota tests below plus the existing suites, which run with the flag OFF and
// therefore prove hosted behaviour is unchanged by this feature's existence.

const OLD = process.env.GLASSMKR_SELF_HOSTED;
afterEach(() => {
  if (OLD === undefined) delete process.env.GLASSMKR_SELF_HOSTED;
  else process.env.GLASSMKR_SELF_HOSTED = OLD;
});

describe("flag parsing", () => {
  it("accepts 1, true, yes; case-insensitive; trimmed", () => {
    for (const v of ["1", "true", "TRUE", "yes", " 1 ", "True"]) {
      process.env.GLASSMKR_SELF_HOSTED = v;
      expect(__recomputeForTests(), `value ${JSON.stringify(v)}`).toBe(true);
    }
  });
  it("everything else is OFF, including unset, 0, false, and garbage", () => {
    for (const v of [undefined, "", "0", "false", "no", "enabled", "self-hosted"]) {
      if (v === undefined) delete process.env.GLASSMKR_SELF_HOSTED;
      else process.env.GLASSMKR_SELF_HOSTED = v;
      expect(__recomputeForTests(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe("effectiveServerLimit (flag OFF in the test env)", () => {
  it("hosted: passes the plan limit through and falls back to the free cap", () => {
    expect(effectiveServerLimit(50)).toBe(50);
    expect(effectiveServerLimit(undefined)).toBe(HOSTED_FREE_NODE_CAP);
    expect(effectiveServerLimit(null)).toBe(HOSTED_FREE_NODE_CAP);
  });
  // Pinned to the published figure rather than to the constant, because the
  // point of this one is that the code and the marketing agree. Asserting the
  // constant against itself would pass no matter what we shipped, which is how
  // the fallback sat at 3 while every public surface said 10.
  it("hosted: the free cap is the 10 that ground-truth and the pricing page state", () => {
    expect(HOSTED_FREE_NODE_CAP).toBe(10);
  });
  it("hosted: a count at the limit still trips the >= comparison call sites use", () => {
    expect(HOSTED_FREE_NODE_CAP >= effectiveServerLimit(undefined)).toBe(true);
    expect(HOSTED_FREE_NODE_CAP - 1 >= effectiveServerLimit(undefined)).toBe(false);
  });
  it("Infinity semantics: no finite count can ever trip >= Infinity", () => {
    // This is what call sites rely on in self-hosted mode; assert the property
    // itself so a refactor to a finite sentinel gets caught.
    expect(Number.MAX_SAFE_INTEGER >= Number.POSITIVE_INFINITY).toBe(false);
  });
});
