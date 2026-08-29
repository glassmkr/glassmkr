// Tests for the daily email-reminders cron path. Verifies:
//   - Flag-off: emits `would-send` log lines, NO Resend calls
//   - Flag-on: calls the send functions
//   - Customer with <=3 active servers is skipped (nothing to suspend)
//   - SQL contract: LEFT JOIN + DISTINCT ON + COALESCE shape, locking
//     the same coverage-gap fix from #33 / PR #34

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

vi.mock("../stripe", () => ({
  stripe: { customers: { retrieve: vi.fn() } },
  isStripeConfigured: () => true,
}));

const sendT3 = vi.fn();
const sendT1 = vi.fn();
vi.mock("../email", () => ({
  sendT3ReminderEmail: (...args: unknown[]) => sendT3(...args),
  sendT1ReminderEmail: (...args: unknown[]) => sendT1(...args),
}));

const { runReminderCycle } = await import("../email-reminders");

let originalFlag: string | undefined;
beforeEach(() => {
  queryMock.mockReset();
  sendT3.mockReset(); sendT3.mockResolvedValue(true);
  sendT1.mockReset(); sendT1.mockResolvedValue(true);
  originalFlag = process.env.BILLING_ENFORCEMENT_ENABLED;
  delete process.env.BILLING_ENFORCEMENT_ENABLED;
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED;
  else process.env.BILLING_ENFORCEMENT_ENABLED = originalFlag;
});

function mockOneCandidate(label: "t3" | "t1", opts?: { servers?: number }) {
  const candidateRow = {
    customer_id: "cust-1",
    email: "user@example.com",
    display_name: "Alex Dev",
    grace_period_end: new Date(),
  };
  const serverCount = opts?.servers ?? 5;
  const servers = Array.from({ length: serverCount }, (_, i) => ({
    id: `s${i + 1}`,
    name: `srv-${i + 1}`,
    created_at: new Date(`2026-0${(i % 9) + 1}-01`),
  }));
  // The cron loops [t3, t1]. We mock the candidate query for the
  // specified label and return [] for the other.
  if (label === "t3") {
    queryMock.mockResolvedValueOnce({ rows: [candidateRow] }); // T-3 candidates
    queryMock.mockResolvedValueOnce({ rows: servers });        // T-3 servers
    queryMock.mockResolvedValueOnce({ rows: [] });             // T-1 candidates (empty)
  } else {
    queryMock.mockResolvedValueOnce({ rows: [] });             // T-3 (empty)
    queryMock.mockResolvedValueOnce({ rows: [candidateRow] }); // T-1 candidates
    queryMock.mockResolvedValueOnce({ rows: servers });        // T-1 servers
  }
}

describe("runReminderCycle", () => {
  it("flag OFF: emits would-send log for T-3, no Resend call", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    mockOneCandidate("t3");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const r = await runReminderCycle();
      expect(r.flag_enabled).toBe(false);
      expect(r.t3_would_send).toBe(1);
      expect(r.t3_sent).toBe(0);
      expect(sendT3).not.toHaveBeenCalled();
      expect(sendT1).not.toHaveBeenCalled();
      const logs = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logs.some((m) => m.includes("would-send t3 customer=cust-1"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("flag ON: calls sendT1ReminderEmail for T-1 candidate", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    mockOneCandidate("t1");
    const r = await runReminderCycle();
    expect(r.flag_enabled).toBe(true);
    expect(r.t1_sent).toBe(1);
    expect(sendT1).toHaveBeenCalledTimes(1);
    const sendArg = sendT1.mock.calls[0][0] as { to: string; firstName: string; disabledServers: Array<{ name: string }> };
    expect(sendArg.to).toBe("user@example.com");
    expect(sendArg.firstName).toBe("Alex");
    expect(sendArg.disabledServers).toHaveLength(2); // 5 servers - 3 free quota = 2 disabled
  });

  it("skips candidate with <=3 active servers (no real suspension impending)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    mockOneCandidate("t3", { servers: 3 });
    const r = await runReminderCycle();
    expect(r.t3_sent).toBe(0);
    expect(r.t3_would_send).toBe(0);
    expect(sendT3).not.toHaveBeenCalled();
  });

  it("uses LEFT JOIN + DISTINCT ON + COALESCE shape (regression-lock for #33)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    await runReminderCycle();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("LEFT JOIN");
    expect(sql).toContain("DISTINCT ON (glassmkr_customer_id)");
    expect(sql).toContain("COALESCE(latest_sub.current_period_end");
    expect(sql).toContain("c.created_at + INTERVAL '30 days'");
    // Locks against the prior INNER JOIN shape:
    expect(sql).not.toMatch(/^\s*JOIN stripe_subscriptions/m);
  });

  it("excludes exempt customers via NOT c.billing_enforcement_exempt predicate (Codex 2026-05-12 P2)", async () => {
    // Mirrors the same regression-lock from enforcement.test.ts. The
    // enforcement scheduler skips exempt customers; the reminder cron
    // must too or staff / comp accounts get T-3 / T-1 emails for a
    // suspension that will never fire.
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    await runReminderCycle();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("NOT COALESCE(c.billing_enforcement_exempt, false)");
  });

  it("first-name fallback uses email local-part when display_name is empty", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    queryMock.mockResolvedValueOnce({ rows: [{
      customer_id: "cust-2", email: "alex@example.com", display_name: null,
      grace_period_end: new Date(),
    }] });
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "s1", name: "a", created_at: new Date() },
      { id: "s2", name: "b", created_at: new Date() },
      { id: "s3", name: "c", created_at: new Date() },
      { id: "s4", name: "d", created_at: new Date() },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // T-1 candidates
    await runReminderCycle();
    const sendArg = sendT3.mock.calls[0][0] as { firstName: string };
    expect(sendArg.firstName).toBe("alex");
  });
});
