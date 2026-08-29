import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static guard for security audit §1.5 item 6 (catalog 3.5): the Stripe
// webhook endpoint must rate-limit per source IP, and that gate must run
// BEFORE signature verification so a forged-request flood can't burn CPU
// on constructEvent. This test regression-locks the wiring (the runtime
// bucket behavior is covered by enforce-ip-rate-limit.test.ts).

const SRC = readFileSync(join(__dirname, "..", "+server.ts"), "utf8");

describe("Stripe webhook per-IP rate limit (§1.5.6)", () => {
  it("imports and calls enforceIpRateLimit with a dedicated stripe-webhook bucket", () => {
    expect(SRC).toContain("enforceIpRateLimit");
    expect(SRC).toContain('namespaceSuffix: "stripe-webhook"');
  });

  it("returns a 429 via rateLimitedResponse when the bucket is empty", () => {
    expect(SRC).toContain("rateLimitedResponse(limited.failure)");
  });

  it("runs the rate-limit gate before signature verification", () => {
    const rlIdx = SRC.indexOf("enforceIpRateLimit");
    const verifyIdx = SRC.indexOf("constructEvent");
    expect(rlIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(rlIdx).toBeLessThan(verifyIdx);
  });
});
