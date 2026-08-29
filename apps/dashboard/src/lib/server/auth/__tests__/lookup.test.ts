// Regression test: a rotated key's old credential must stop authenticating
// the moment its grace window ends, NOT linger until the daily reaper sets
// revoked_at. Rotation sets grace_period_ends_at (not expires_at), so the
// expires_at gate does not cover it; lookupAcctKey must check grace directly.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import { lookupAcctKey } from "../lookup";
import { setPepperForTests, generateAccountKey } from "../keys";

const TEST_PEPPER = "0123456789abcdef0123456789abcdef-test-pepper-32+chars";

beforeEach(() => {
  setPepperForTests(TEST_PEPPER);
  (query as any).mockReset();
  // Default for the fire-and-forget last_used_at UPDATE (2nd call on the
  // success path) so it resolves rather than throwing.
  (query as any).mockResolvedValue({ rows: [] });
});

function rowFor(parsed: { prefix: string }, over: Record<string, unknown> = {}) {
  return {
    rows: [
      {
        id: "key_1",
        customer_id: "cust_1",
        prefix: parsed.prefix,
        scope: "admin",
        expires_at: null,
        revoked_at: null,
        grace_period_ends_at: null,
        plan: "pro",
        ...over,
      },
    ],
  };
}

describe("lookupAcctKey grace-period enforcement", () => {
  it("rejects a key whose grace window has already ended (does not wait for the reaper)", async () => {
    const parsed = generateAccountKey("live");
    (query as any).mockResolvedValueOnce(
      rowFor(parsed, { grace_period_ends_at: new Date(Date.now() - 60_000) }),
    );
    expect(await lookupAcctKey(parsed)).toBeNull();
  });

  it("accepts a key still within its grace window", async () => {
    const parsed = generateAccountKey("live");
    (query as any).mockResolvedValueOnce(
      rowFor(parsed, { grace_period_ends_at: new Date(Date.now() + 3_600_000) }),
    );
    const p = await lookupAcctKey(parsed);
    expect(p?.kind).toBe("acct_key");
    expect(p?.customer_id).toBe("cust_1");
  });

  it("accepts a normal key with no grace period set", async () => {
    const parsed = generateAccountKey("live");
    (query as any).mockResolvedValueOnce(rowFor(parsed, { grace_period_ends_at: null }));
    expect((await lookupAcctKey(parsed))?.kind).toBe("acct_key");
  });

  it("still rejects a revoked key (existing behaviour intact)", async () => {
    const parsed = generateAccountKey("live");
    (query as any).mockResolvedValueOnce(rowFor(parsed, { revoked_at: new Date() }));
    expect(await lookupAcctKey(parsed)).toBeNull();
  });
});
