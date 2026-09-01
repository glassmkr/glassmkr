// LB-1 (Grok + Codex security review, 2026-09-01). resolveOAuthCustomer must
// REFUSE to link or create in exactly the cases that enabled account takeover.
// The refused variants are asserted first, per the house rule.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
// mapCustomer is a trivial row->payload mapper tested elsewhere; identity is
// enough here to assert which row was chosen.
vi.mock("@glassmkr/auth", () => ({ mapCustomer: (row: any) => row }));

import { query, withTransaction } from "@glassmkr/db/pg";
import { resolveOAuthCustomer } from "../oauth-link";

const clientQuery = vi.fn();

beforeEach(() => {
  (query as any).mockReset();
  (withTransaction as any).mockReset();
  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rows: [] });
  (withTransaction as any).mockImplementation(async (fn: any) => fn({ query: clientQuery }));
});

const base = {
  provider: "github",
  providerUserId: "gh-123",
  email: "victim@example.com",
  name: "V",
  emailVerifiedByProvider: true,
  registrationDisabled: false,
};

describe("resolveOAuthCustomer - refused variants (the takeover paths)", () => {
  it("REFUSES to link when the existing account is unverified (pre-registration attack)", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] }); // no existing oauth link
    (query as any).mockResolvedValueOnce({ rows: [{ id: "c1", email: "victim@example.com", email_verified: false }] });
    const r = await resolveOAuthCustomer({ ...base, emailVerifiedByProvider: true });
    expect(r.status).toBe("needs_recovery");
    expect(withTransaction).not.toHaveBeenCalled(); // never linked
  });

  it("REFUSES to link when the provider did not verify the incoming email (spoofed email)", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] });
    (query as any).mockResolvedValueOnce({ rows: [{ id: "c1", email: "victim@example.com", email_verified: true }] });
    const r = await resolveOAuthCustomer({ ...base, emailVerifiedByProvider: false });
    expect(r.status).toBe("needs_recovery");
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("REFUSES to create a verified account from an unverified provider email", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] });
    (query as any).mockResolvedValueOnce({ rows: [] });
    const r = await resolveOAuthCustomer({ ...base, emailVerifiedByProvider: false });
    expect(r.status).toBe("needs_recovery");
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("rejects a missing provider id rather than minting an 'undefined' identity", async () => {
    const r = await resolveOAuthCustomer({ ...base, providerUserId: "" });
    expect(r.status).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects the literal string 'undefined' as a provider id", async () => {
    const r = await resolveOAuthCustomer({ ...base, providerUserId: "undefined" });
    expect(r.status).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a missing email", async () => {
    const r = await resolveOAuthCustomer({ ...base, email: "" });
    expect(r.status).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("returns registration_disabled instead of creating when registration is closed", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] });
    (query as any).mockResolvedValueOnce({ rows: [] });
    const r = await resolveOAuthCustomer({ ...base, registrationDisabled: true });
    expect(r.status).toBe("registration_disabled");
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("resolveOAuthCustomer - allowed paths", () => {
  it("returns the linked account when the provider identity already exists", async () => {
    (query as any).mockResolvedValueOnce({ rows: [{ id: "c9", email: "who@example.com", email_verified: true }] });
    const r = await resolveOAuthCustomer(base);
    expect(r.status).toBe("ok");
    expect((r as any).customer.id).toBe("c9");
    expect(query).toHaveBeenCalledTimes(1); // short-circuits on the link lookup
  });

  it("links to an existing account only when both sides are verified", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] });
    (query as any).mockResolvedValueOnce({ rows: [{ id: "c1", email: "victim@example.com", email_verified: true }] });
    const r = await resolveOAuthCustomer({ ...base, emailVerifiedByProvider: true });
    expect(r.status).toBe("ok");
    expect((r as any).customer.id).toBe("c1");
    expect(withTransaction).toHaveBeenCalledTimes(1);
    // the transaction linked the identity
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO oauth_identities"), expect.any(Array));
  });

  it("creates a new verified account from a verified provider email", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] }); // no link
    (query as any).mockResolvedValueOnce({ rows: [] }); // no email match
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "new1", email: "victim@example.com", email_verified: true }] }); // INSERT customers
    const r = await resolveOAuthCustomer(base);
    expect(r.status).toBe("ok");
    expect((r as any).customer.id).toBe("new1");
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it("lower-cases the incoming email before lookup", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] });
    (query as any).mockResolvedValueOnce({ rows: [] });
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "new2", email: "mixed@example.com", email_verified: true }] });
    await resolveOAuthCustomer({ ...base, email: "Mixed@Example.COM" });
    // the email-match SELECT (2nd top-level query) received the lowercased value
    expect((query as any).mock.calls[1][1]).toEqual(["mixed@example.com"]);
  });
});

describe("resolveOAuthCustomer - create-conflict race (round-2 #1)", () => {
  it("REFUSES to link when a race created an UNVERIFIED account after the lookup", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] }); // no existing link
    (query as any).mockResolvedValueOnce({ rows: [] }); // no email match at step 2
    clientQuery.mockResolvedValueOnce({ rows: [] }); // INSERT customers -> ON CONFLICT (raced)
    clientQuery.mockResolvedValueOnce({
      rows: [{ id: "raced-attacker", email: "victim@example.com", email_verified: false }],
    }); // re-select finds the racing UNVERIFIED row
    const r = await resolveOAuthCustomer(base);
    expect(r.status).toBe("needs_recovery");
    // never reached the oauth_identities INSERT: only the INSERT + re-select ran
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it("links when the race created an ALREADY-VERIFIED account (safe)", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] });
    (query as any).mockResolvedValueOnce({ rows: [] });
    clientQuery.mockResolvedValueOnce({ rows: [] }); // INSERT -> conflict
    clientQuery.mockResolvedValueOnce({
      rows: [{ id: "raced-legit", email: "victim@example.com", email_verified: true }],
    }); // re-select finds a verified row
    clientQuery.mockResolvedValueOnce({ rows: [] }); // INSERT oauth_identities
    const r = await resolveOAuthCustomer(base);
    expect(r.status).toBe("ok");
    expect((r as any).customer.id).toBe("raced-legit");
  });
});
