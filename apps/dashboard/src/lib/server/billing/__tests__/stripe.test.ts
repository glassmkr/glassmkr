// Pricing math tests. Kept separate from sync.test.ts so these don't need the
// Stripe/pg mocks.

import { describe, it, expect } from "vitest";
import {
  computeMonthlyCost,
  billableNodes,
  PRICE_PER_NODE_USD,
  FREE_NODES_PRO,
} from "../stripe";

describe("billableNodes", () => {
  it("returns 0 for counts within the free quota", () => {
    expect(billableNodes(0)).toBe(0);
    expect(billableNodes(1)).toBe(0);
    expect(billableNodes(2)).toBe(0);
    expect(billableNodes(3)).toBe(0);
  });
  it("subtracts the 3-server free quota for counts above it", () => {
    expect(billableNodes(4)).toBe(1);
    expect(billableNodes(5)).toBe(2);
    expect(billableNodes(50)).toBe(47);
  });
  it("clamps negative counts to 0", () => {
    expect(billableNodes(-5)).toBe(0);
  });
});

describe("computeMonthlyCost", () => {
  it("returns 0 for free plan regardless of node count", () => {
    expect(computeMonthlyCost("free", 0)).toBe(0);
    expect(computeMonthlyCost("free", 3)).toBe(0);
    expect(computeMonthlyCost("free", 100)).toBe(0);
  });

  it("returns 0 for unknown / enterprise plans (caller handles enterprise separately)", () => {
    expect(computeMonthlyCost("enterprise", 10)).toBe(0);
    expect(computeMonthlyCost("mystery", 10)).toBe(0);
  });

  it("returns 0 for Pro accounts within the 3-server free quota", () => {
    expect(computeMonthlyCost("pro", 0)).toBe(0);
    expect(computeMonthlyCost("pro", 1)).toBe(0);
    expect(computeMonthlyCost("pro", 2)).toBe(0);
    expect(computeMonthlyCost("pro", 3)).toBe(0);
  });

  it("charges Pro for every node above the free quota", () => {
    expect(computeMonthlyCost("pro", 4)).toBe(PRICE_PER_NODE_USD);     // 1 chargeable
    expect(computeMonthlyCost("pro", 5)).toBe(PRICE_PER_NODE_USD * 2); // 2 chargeable
    expect(computeMonthlyCost("pro", 10)).toBe(PRICE_PER_NODE_USD * 7);
    expect(computeMonthlyCost("pro", 50)).toBe(PRICE_PER_NODE_USD * 47); // = 141
  });

  it("treats negative node counts as zero (defensive)", () => {
    expect(computeMonthlyCost("pro", -5)).toBe(0);
  });

  it("uses $3 as the per-node price and 3 as the free quota", () => {
    expect(PRICE_PER_NODE_USD).toBe(3);
    expect(FREE_NODES_PRO).toBe(3);
  });
});
