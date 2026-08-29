import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registrationDisabled } from "../registration";

const OLD = process.env.GLASSMKR_DISABLE_REGISTRATION;
afterEach(() => {
  if (OLD === undefined) delete process.env.GLASSMKR_DISABLE_REGISTRATION;
  else process.env.GLASSMKR_DISABLE_REGISTRATION = OLD;
});

describe("registrationDisabled", () => {
  it("is off by default, so the documented first-run flow works", () => {
    delete process.env.GLASSMKR_DISABLE_REGISTRATION;
    expect(registrationDisabled()).toBe(false);
  });

  it("accepts the documented truthy spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes", "Yes"]) {
      process.env.GLASSMKR_DISABLE_REGISTRATION = v;
      expect(registrationDisabled(), v).toBe(true);
    }
  });

  it("treats anything else as off rather than guessing", () => {
    for (const v of ["", "0", "false", "no", "disabled", "off"]) {
      process.env.GLASSMKR_DISABLE_REGISTRATION = v;
      expect(registrationDisabled(), v).toBe(false);
    }
  });
});

// The flag has to close every account-CREATING path. The OAuth callbacks
// create an account for any unrecognised provider identity, so an instance
// with GitHub or Google configured would otherwise still hand an account to
// anyone who could click "sign in with GitHub". This is a structural check:
// it asserts the guard exists and runs BEFORE the insert, which is the
// property that actually matters and the one a careless edit would break.
function guardPrecedesAccountCreation(source: string): boolean {
  const guard = source.indexOf("registrationDisabled()");
  const insert = source.indexOf("INSERT INTO customers");
  return guard !== -1 && insert !== -1 && guard < insert;
}

describe("guardPrecedesAccountCreation (the checker itself)", () => {
  it("rejects a source where the guard runs after the insert", () => {
    expect(guardPrecedesAccountCreation(`
      await query("INSERT INTO customers (email) VALUES ($1)", [email]);
      if (registrationDisabled()) throw new Error("too late");
    `)).toBe(false);
  });

  it("rejects a source with no guard at all", () => {
    expect(guardPrecedesAccountCreation(`
      await query("INSERT INTO customers (email) VALUES ($1)", [email]);
    `)).toBe(false);
  });

  it("accepts a source guarded before the insert", () => {
    expect(guardPrecedesAccountCreation(`
      if (registrationDisabled()) throw new RegistrationDisabledError();
      await query("INSERT INTO customers (email) VALUES ($1)", [email]);
    `)).toBe(true);
  });
});

describe("OAuth callbacks honour the flag", () => {
  for (const provider of ["github", "google"]) {
    it(`${provider} refuses to create a new account when registration is closed`, () => {
      const path = resolve(
        __dirname,
        `../../../../routes/auth/callback/${provider}/+server.ts`,
      );
      expect(guardPrecedesAccountCreation(readFileSync(path, "utf8"))).toBe(true);
    });
  }
});
