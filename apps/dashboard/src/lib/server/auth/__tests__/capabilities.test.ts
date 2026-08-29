import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  isCapability,
  parseCapabilities,
  principalHasCapability,
} from "../capabilities";

// The whole point of capabilities is that they are NOT inherited. Permanently
// destroying a server is a different kind of authority from "admin", not a
// higher tier of it, and folding it into the read<write<admin ladder would have
// granted it to every admin key in existence the moment it shipped.
describe("capabilities are opt-in and never inherited", () => {
  it("a principal with no capabilities holds none", () => {
    // This is the shape of every key created before migration 041.
    expect(principalHasCapability({ capabilities: [] }, "servers:purge")).toBe(false);
    expect(principalHasCapability({ capabilities: null }, "servers:purge")).toBe(false);
    expect(principalHasCapability({}, "servers:purge")).toBe(false);
  });

  it("admin scope alone does not confer a capability", () => {
    // The regression that matters. If someone adds `scope` handling here and
    // waves admin through, this fails.
    const admin = { kind: "acct_key", scope: "admin", capabilities: [] as never[] };
    expect(principalHasCapability(admin, "servers:purge")).toBe(false);
  });

  it("a session does not confer a capability either", () => {
    // Unlike requireScopeLevel, which lets sessions pass because the UI is the
    // authority for human traffic. There is no purge button, so a session
    // reaching a purge endpoint is a request the interface cannot produce.
    expect(principalHasCapability({ kind: "session", authKind: "session" }, "servers:purge")).toBe(false);
  });

  it("only an explicitly granted capability is held", () => {
    expect(principalHasCapability({ capabilities: ["servers:purge"] }, "servers:purge")).toBe(true);
  });
});

describe("parsing the capabilities column", () => {
  it("drops anything unrecognised rather than trusting it", () => {
    // The column is jsonb; a value that got in by some other path must not
    // become authority just because it is a string in an array.
    expect(parseCapabilities(["servers:purge", "servers:nuke", 42, null, {}])).toEqual([
      "servers:purge",
    ]);
  });

  it("treats a non-array as no capabilities", () => {
    for (const v of [null, undefined, "servers:purge", 7, {}]) {
      expect(parseCapabilities(v)).toEqual([]);
    }
  });

  it("recognises exactly the declared set", () => {
    expect([...CAPABILITIES]).toEqual(["servers:purge"]);
    expect(isCapability("servers:purge")).toBe(true);
    expect(isCapability("servers:manage")).toBe(false); // the dropped v1 field
    expect(isCapability("admin")).toBe(false);
  });
});
