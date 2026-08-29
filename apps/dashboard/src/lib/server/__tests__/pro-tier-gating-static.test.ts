import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static guard for the P0-03 resolution (2026-08-29): HOSTED HAS NO PAID TIER.
// ground-truth.yaml hosted_pricing_state is resolved as free, and the public
// tier-gating docs have said "the Free/Pro split was retired" since the pivot.
//
// The previous version of this file pinned the OPPOSITE: it required the
// analyze route and the audit route to keep their requireProTier gates, so the
// test suite itself was defending the contradiction the audit flagged. Its
// assertions are inverted rather than deleted; the retired gating is what must
// never quietly return.
//
// Re-gating anything is a registry-first change: ground-truth.yaml, then
// lint-plan-language, then code, in that order.

const API_ROOT = join(__dirname, "..", "..", "..", "routes", "api", "v1");
const PLAN_FILE = join(__dirname, "..", "auth", "plan.ts");

describe("tier-gating static guard (P0-03: no paid tier)", () => {
  it("requireProTier is a pass-through with no plan branch and no 402", () => {
    const src = readFileSync(PLAN_FILE, "utf8");
    const fn = src.slice(src.indexOf("export function requireProTier"), src.indexOf("export function requireProTierForAcctKey"));
    expect(fn).toContain("return;");
    expect(fn).not.toContain("error(402");
    expect(fn).not.toMatch(/PRO_PLANS|principal\.plan/);
  });

  it("the analyze route has no free-analysis meter", () => {
    // First pass kept the meter as dormant constants (canAnalyze = true,
    // freeUserFirstUse = false) and this test pinned those. Codex 2026-08-29
    // #16: dormant machinery is one refactor away from resurrection, and its
    // split upsell string was invisible to lint:plan-language. The machinery
    // is deleted now, so pin the ABSENCE.
    const src = readFileSync(join(API_ROOT, "servers/[id]/analyze/+server.ts"), "utf8");
    expect(src).not.toContain("canAnalyze");
    expect(src).not.toContain("freeUserFirstUse");
    expect(src).not.toContain("upgrade_url");
    expect(src).not.toMatch(/UPDATE servers SET free_analysis_used/);
  });

  it("the audit route serves one window, with no plan branch", () => {
    const src = readFileSync(join(API_ROOT, "account/audit/+server.ts"), "utf8");
    expect(src).toContain("const retentionDays = 365;");
    expect(src).not.toMatch(/isPro \? 365 : 30/);
  });

  it("checkout refuses to create anything, before touching Stripe", () => {
    const src = readFileSync(join(API_ROOT, "billing/checkout/+server.ts"), "utf8");
    expect(src).toContain("410");
    expect(src).toContain("no_paid_tier");
    expect(src).not.toMatch(/stripe\.(customers|checkout)/);
  });

  it("a cancelled legacy subscription lands on the CURRENT hosted contract", () => {
    const src = readFileSync(join(__dirname, "..", "billing", "stripe.ts"), "utf8");
    expect(src).toContain("HOSTED_FREE_NODE_CAP");
    expect(src).not.toMatch(/free:\s*\{\s*server_limit:\s*3\b/);
    expect(src).not.toMatch(/retention_days:\s*7\b/);
  });

  it("server creation is still bounded by the node-count quota (a capacity cap, not a plan)", () => {
    const source = readFileSync(join(API_ROOT, "servers/+server.ts"), "utf8");
    expect(source).toContain("plan_server_limit");
    expect(source).toContain("quota_exceeded");
  });

  it("requireProTierForAcctKey remains a no-op", () => {
    const src = readFileSync(PLAN_FILE, "utf8");
    const fn = src.slice(src.indexOf("export function requireProTierForAcctKey"));
    expect(fn.slice(0, 400)).toContain("return;");
  });
});
