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

// The flag has to close every account-CREATING path. Account creation for an
// unrecognised OAuth identity is now centralised in resolveOAuthCustomer
// (oauth-link.ts): the callbacks pass the live registrationDisabled() flag in,
// and the resolver refuses (returns "registration_disabled") BEFORE the insert.
// This is a structural check of the property that actually matters and the one a
// careless edit would break: the guard runs before the insert in the resolver,
// AND each callback wires the flag in, handles the refusal, and no longer
// creates accounts inline.
function guardPrecedesAccountCreation(source: string, guardToken: string): boolean {
  const guard = source.indexOf(guardToken);
  const insert = source.indexOf("INSERT INTO customers");
  return guard !== -1 && insert !== -1 && guard < insert;
}

describe("guardPrecedesAccountCreation (the checker itself)", () => {
  const token = "input.registrationDisabled";
  it("rejects a source where the guard runs after the insert", () => {
    expect(guardPrecedesAccountCreation(`
      await client.query("INSERT INTO customers (email) VALUES ($1)", [email]);
      if (input.registrationDisabled) return { status: "registration_disabled" };
    `, token)).toBe(false);
  });

  it("rejects a source with no guard at all", () => {
    expect(guardPrecedesAccountCreation(`
      await client.query("INSERT INTO customers (email) VALUES ($1)", [email]);
    `, token)).toBe(false);
  });

  it("accepts a source guarded before the insert", () => {
    expect(guardPrecedesAccountCreation(`
      if (input.registrationDisabled) return { status: "registration_disabled" };
      await client.query("INSERT INTO customers (email) VALUES ($1)", [email]);
    `, token)).toBe(true);
  });
});

describe("OAuth account creation honours the flag", () => {
  it("the resolver guards creation before the INSERT", () => {
    const src = readFileSync(resolve(__dirname, "../oauth-link.ts"), "utf8");
    expect(guardPrecedesAccountCreation(src, "input.registrationDisabled")).toBe(true);
  });

  for (const provider of ["github", "google"]) {
    it(`${provider} callback wires the live flag in, handles refusal, and never creates inline`, () => {
      const src = readFileSync(
        resolve(__dirname, `../../../../routes/auth/callback/${provider}/+server.ts`),
        "utf8",
      );
      expect(src.includes("registrationDisabled: registrationDisabled()")).toBe(true);
      expect(src.includes('"registration_disabled"')).toBe(true);
      expect(src.includes("INSERT INTO customers")).toBe(false);
    });
  }
});
