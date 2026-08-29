// Unit tests for the channel identifier abuse check.
//
// The check itself issues SQL against @glassmkr/db/pg, which is mocked here.
// These tests verify the decision logic (who wins, who loses) without touching
// a real database. Full integration coverage lives in integration/.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pg module before the module under test imports it.
const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const { canUseChannelIdentifier } = await import("../abuse-check");

function mockQueries(sequence: Array<{ rows: Array<Record<string, unknown>> }>) {
  queryMock.mockReset();
  for (const result of sequence) queryMock.mockResolvedValueOnce(result);
}

describe("canUseChannelIdentifier", () => {
  beforeEach(() => queryMock.mockReset());

  it("allows an identifier nobody else uses", async () => {
    mockQueries([{ rows: [] }]); // existing lookup: empty
    const r = await canUseChannelIdentifier("cust-A", "telegram", { chat_id: "123" });
    expect(r.allowed).toBe(true);
  });

  it("allows Slack regardless of sharing (Slack is Pro-only by plan gating)", async () => {
    const r = await canUseChannelIdentifier("cust-A", "slack", { webhook_url: "https://hooks.slack.com/x" });
    expect(r.allowed).toBe(true);
    expect(queryMock).not.toHaveBeenCalled(); // early return, no DB hit
  });

  it("allows empty config (no identifier to compare)", async () => {
    const r = await canUseChannelIdentifier("cust-A", "telegram", {});
    expect(r.allowed).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a Free customer reusing another Free customer's chat_id", async () => {
    mockQueries([
      { rows: [{ customer_id: "cust-B" }] }, // existing: cust-B also uses chat_id=123
      { rows: [{ plan: "free" }] },          // current customer plan
      { rows: [{ id: "cust-B" }] },          // conflicting free customer exists
    ]);
    const r = await canUseChannelIdentifier("cust-A", "telegram", { chat_id: "123" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Telegram chat");
    expect(r.reason).toContain("already used by another account");
  });

  it("allows a Pro customer to reuse any identifier", async () => {
    mockQueries([
      { rows: [{ customer_id: "cust-B" }] }, // existing holder
      { rows: [{ plan: "pro" }] },           // current customer is Pro
    ]);
    const r = await canUseChannelIdentifier("cust-A", "telegram", { chat_id: "123" });
    expect(r.allowed).toBe(true);
  });

  it("allows Enterprise customers to reuse any identifier", async () => {
    mockQueries([
      { rows: [{ customer_id: "cust-B" }] },
      { rows: [{ plan: "enterprise" }] },
    ]);
    const r = await canUseChannelIdentifier("cust-A", "telegram", { chat_id: "123" });
    expect(r.allowed).toBe(true);
  });

  it("allows a Free customer if the other holders are all Pro/Enterprise", async () => {
    mockQueries([
      { rows: [{ customer_id: "cust-B" }] }, // existing holder
      { rows: [{ plan: "free" }] },          // current is Free
      { rows: [] },                          // no conflicting FREE customer
    ]);
    const r = await canUseChannelIdentifier("cust-A", "telegram", { chat_id: "123" });
    expect(r.allowed).toBe(true);
  });

  it("checks email identifier with correct error message", async () => {
    mockQueries([
      { rows: [{ customer_id: "cust-B" }] },
      { rows: [{ plan: "free" }] },
      { rows: [{ id: "cust-B" }] },
    ]);
    const r = await canUseChannelIdentifier("cust-A", "email", { email: "alerts@example.com" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("email address");
  });

  it("respects excludeChannelId when updating a channel (does not flag itself)", async () => {
    mockQueries([{ rows: [] }]); // no conflicts after excluding self
    const r = await canUseChannelIdentifier("cust-A", "telegram", { chat_id: "123" }, 42);
    expect(r.allowed).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("AND id != $5"),
      expect.arrayContaining(["telegram", "chat_id", "123", "cust-A", 42])
    );
  });
});
