// Tests the billing-enforcement gate added to dispatchNotifications.
// The gate is one short-circuit: when flag is on AND server.status is
// 'suspended', return early before fetching channels. When flag is off,
// pass through unchanged regardless of suspended state.
//
// Scoped tightly: we don't exercise the full Telegram/Slack/email
// fanout — just verify whether the channel SELECT is reached.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

vi.mock("@glassmkr/db/clickhouse", () => ({ clickhouse: {} }));

// The dispatcher imports a presentation helper bundle and an email
// helper. We don't trigger the email path in these tests (no channels
// returned for the active-server cases either, by design), so a no-op
// mock is sufficient.
vi.mock("$lib/alerts/presentation", () => ({
  getPriority: () => "P3",
  PRIORITY_LABELS: {},
  PRIORITY_EMOJI: {},
  SLACK_COLORS: {},
  RESOLVED_COLOR: "#000000",
  formatDuration: () => "0s",
}));
vi.mock("../email", () => ({ sendEmail: vi.fn() }));
vi.mock("../context", () => ({ buildContextBlock: async () => null }));

const { dispatchNotifications } = await import("../dispatcher");

let originalFlag: string | undefined;
beforeEach(() => {
  queryMock.mockReset();
  originalFlag = process.env.BILLING_ENFORCEMENT_ENABLED;
  delete process.env.BILLING_ENFORCEMENT_ENABLED;
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED;
  else process.env.BILLING_ENFORCEMENT_ENABLED = originalFlag;
});

const sampleAlert = {
  id: 1,
  alert_type: "ram_high",
  severity: "warning",
  title: "RAM 92%",
  message: "RAM at 92%",
  evidence: {},
  recommendation: "scale up",
};

describe("dispatchNotifications billing-enforcement gate", () => {
  it("flag OFF + suspended server: passes through (channels fetched)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    queryMock.mockResolvedValueOnce({ rows: [{
      id: "srv_1", name: "x", hostname: "h", ip: "1.1.1.1",
      customer_id: "cust-1", status: "suspended",
    }]});
    queryMock.mockResolvedValueOnce({ rows: [] }); // no channels
    await dispatchNotifications("srv_1", [sampleAlert], []);
    // Two queries: server lookup + channel lookup. Gate did NOT short-circuit.
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1][0])).toContain("alert_channels");
  });

  it("flag ON + suspended server: short-circuits BEFORE channel SELECT", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    queryMock.mockResolvedValueOnce({ rows: [{
      id: "srv_1", name: "x", hostname: "h", ip: "1.1.1.1",
      customer_id: "cust-1", status: "suspended",
    }]});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await dispatchNotifications("srv_1", [sampleAlert], []);
      expect(queryMock).toHaveBeenCalledTimes(1); // only the server lookup
      const logs = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logs.some((m) => m.includes("alert dispatch suppressed") && m.includes("srv_1"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("flag ON + active server: passes through (channels fetched)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    queryMock.mockResolvedValueOnce({ rows: [{
      id: "srv_1", name: "x", hostname: "h", ip: "1.1.1.1",
      customer_id: "cust-1", status: "active",
    }]});
    queryMock.mockResolvedValueOnce({ rows: [] }); // no channels — exit cleanly
    await dispatchNotifications("srv_1", [sampleAlert], []);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("flag OFF + active server: passes through (control case)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{
      id: "srv_1", name: "x", hostname: "h", ip: "1.1.1.1",
      customer_id: "cust-1", status: "active",
    }]});
    queryMock.mockResolvedValueOnce({ rows: [] });
    await dispatchNotifications("srv_1", [sampleAlert], []);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("server not found: returns early, no channel lookup attempted", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    queryMock.mockResolvedValueOnce({ rows: [] }); // server not found
    await dispatchNotifications("srv_missing", [sampleAlert], []);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
