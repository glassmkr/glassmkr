import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isBillingEnforcementEnabled } from "../enforcement-flag";

describe("isBillingEnforcementEnabled", () => {
  let originalValue: string | undefined;
  beforeEach(() => {
    originalValue = process.env.BILLING_ENFORCEMENT_ENABLED;
    delete process.env.BILLING_ENFORCEMENT_ENABLED;
  });
  afterEach(() => {
    if (originalValue === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED;
    else process.env.BILLING_ENFORCEMENT_ENABLED = originalValue;
  });

  it("returns false when env var unset (default)", () => {
    expect(isBillingEnforcementEnabled()).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "";
    expect(isBillingEnforcementEnabled()).toBe(false);
  });

  it("returns false on truthy-looking-but-not-listed values", () => {
    for (const v of ["enabled", "TRUE!", "y", "0", "false", "no"]) {
      process.env.BILLING_ENFORCEMENT_ENABLED = v;
      expect(isBillingEnforcementEnabled(), `value=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("returns true on the canonical truthy values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "Yes", "on", "ON"]) {
      process.env.BILLING_ENFORCEMENT_ENABLED = v;
      expect(isBillingEnforcementEnabled(), `value=${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("read-throughs each call (no caching of process.env)", () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    expect(isBillingEnforcementEnabled()).toBe(false);
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    expect(isBillingEnforcementEnabled()).toBe(true);
    process.env.BILLING_ENFORCEMENT_ENABLED = "";
    expect(isBillingEnforcementEnabled()).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "  true  ";
    expect(isBillingEnforcementEnabled()).toBe(true);
  });
});
