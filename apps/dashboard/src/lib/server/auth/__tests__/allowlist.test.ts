import { describe, it, expect } from "vitest";
import { pickAllowedFields, pickAllowedFieldsStrict } from "../allowlist.js";

// Threat A5 (mass assignment / BOPLA): a customer sends extra fields in
// a POST body and tries to overwrite server-controlled columns.

describe("pickAllowedFields", () => {
  it("returns only allowed keys present in the body", () => {
    const body = { hostname: "foo", name: "bar", account_id: "evil" };
    const out = pickAllowedFields(body, ["hostname", "name"]);
    expect(out).toEqual({ hostname: "foo", name: "bar" });
    expect("account_id" in out).toBe(false);
  });

  it("silently drops keys not in allowlist (the mass-assignment defence)", () => {
    const body = {
      hostname: "good.example.com",
      account_id: "hijack-account",
      created_at: "1970-01-01T00:00:00Z",
      collector_key_hash: "<arbitrary>",
      id: "srv_evil",
    };
    const out = pickAllowedFields(body, ["hostname"]);
    expect(out).toEqual({ hostname: "good.example.com" });
    // None of the dangerous fields leaked through.
    expect("account_id" in out).toBe(false);
    expect("created_at" in out).toBe(false);
    expect("collector_key_hash" in out).toBe(false);
    expect("id" in out).toBe(false);
  });

  it("preserves explicit null values when the key is allowed", () => {
    const body = { name: null, hostname: "h" };
    const out = pickAllowedFields(body, ["name", "hostname"]);
    expect(out).toEqual({ name: null, hostname: "h" });
  });

  it("returns empty object when body is not an object", () => {
    expect(pickAllowedFields(null, ["a"])).toEqual({});
    expect(pickAllowedFields(undefined, ["a"])).toEqual({});
    expect(pickAllowedFields("not an object", ["a"])).toEqual({});
    expect(pickAllowedFields(123, ["a"])).toEqual({});
    expect(pickAllowedFields([], ["a"])).toEqual({});
  });

  it("returns empty object when allowlist is empty", () => {
    expect(pickAllowedFields({ a: 1, b: 2 }, [])).toEqual({});
  });

  it("does not include keys that are absent from the body even if allowed", () => {
    const body = { a: 1 };
    const out = pickAllowedFields(body, ["a", "b"]);
    expect(out).toEqual({ a: 1 });
    expect("b" in out).toBe(false);
  });

  it("ignores prototype-chain pollution attempts", () => {
    const body = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
    const out = pickAllowedFields(body, ["a"]);
    expect(out).toEqual({ a: 1 });
    // The literal __proto__ key is not in our allowlist, so it gets
    // dropped along with everything else not allowed. The defence is the
    // allowlist, not the prototype awareness; this test documents that.
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("pickAllowedFieldsStrict", () => {
  it("throws when an unexpected field is present", () => {
    expect(() => pickAllowedFieldsStrict({ hostname: "h", account_id: "x" }, ["hostname"]))
      .toThrow(/unexpected fields/);
  });

  it("returns the allowed subset on a clean body", () => {
    expect(pickAllowedFieldsStrict({ hostname: "h" }, ["hostname"]))
      .toEqual({ hostname: "h" });
  });

  it("throws on non-object body", () => {
    expect(() => pickAllowedFieldsStrict("nope", ["a"])).toThrow();
    expect(() => pickAllowedFieldsStrict([1, 2], ["a"])).toThrow();
  });
});

// Concrete BOLA + BOPLA scenario tests using the helper. These are the
// shape of tests every endpoint that uses pickAllowedFields should
// repeat in its own test file.

describe("BOPLA defence: server creation body", () => {
  const ALLOWED_FIELDS = ["hostname", "name", "tags"] as const;

  it("rejects an attempt to set account_id via the body", () => {
    const malicious = {
      hostname: "good.example.com",
      name: "real-name",
      tags: ["prod"],
      account_id: "victim_account_id",
    };
    const sanitised = pickAllowedFields(malicious, ALLOWED_FIELDS);
    expect("account_id" in sanitised).toBe(false);
  });

  it("rejects an attempt to set id via the body", () => {
    const sanitised = pickAllowedFields({ hostname: "h", id: "srv_target" }, ALLOWED_FIELDS);
    expect("id" in sanitised).toBe(false);
  });

  it("rejects an attempt to set collector_key_hash via the body", () => {
    const sanitised = pickAllowedFields(
      { hostname: "h", collector_key_hash: "deadbeef" },
      ALLOWED_FIELDS,
    );
    expect("collector_key_hash" in sanitised).toBe(false);
  });

  it("rejects an attempt to set last_seen_at via the body", () => {
    const sanitised = pickAllowedFields(
      { hostname: "h", last_seen_at: "1970-01-01" },
      ALLOWED_FIELDS,
    );
    expect("last_seen_at" in sanitised).toBe(false);
  });
});
