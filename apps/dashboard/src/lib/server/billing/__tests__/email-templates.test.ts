// Email content render tests for the four billing-enforcement
// templates. Mocks the Resend SDK so we can call the send-fn and
// inspect what it would have sent. This locks the subject + body
// fragments so wording changes are deliberate.

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => {
  class FakeResend {
    emails = { send: (args: unknown) => sendMock(args) };
  }
  return { Resend: FakeResend };
});

const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY;
process.env.RESEND_API_KEY = "re_test_dummy";

const {
  sendCardRemovedEmail,
  sendT3ReminderEmail,
  sendT1ReminderEmail,
  sendServersDisabledEmail,
} = await import("../email");

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ error: null });
});

describe("sendCardRemovedEmail", () => {
  it("subject + body include expected fields", async () => {
    const ok = await sendCardRemovedEmail({
      to: "user@example.com",
      firstName: "Alex",
      activeServerCount: 5,
      currentPeriodEndUtc: "2026-06-15 12:00 UTC",
    });
    expect(ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0][0] as { to: string; subject: string; html: string; text: string };
    expect(args.to).toBe("user@example.com");
    expect(args.subject).toBe("Your payment method was removed");
    expect(args.html).toContain("Hi Alex");
    expect(args.html).toContain("5 active servers");
    expect(args.html).toContain("2026-06-15 12:00 UTC");
    expect(args.text).toContain("Hi Alex");
    expect(args.text).toContain("5 active servers");
    expect(args.text).toContain("2026-06-15 12:00 UTC");
  });
});

describe("sendT3ReminderEmail", () => {
  it("includes both kept and disabled server lists", async () => {
    await sendT3ReminderEmail({
      to: "user@example.com",
      firstName: "Alex",
      gracePeriodEndUtc: "2026-05-12 00:00 UTC",
      keptServers: [
        { name: "web-01", createdAtUtc: "2026-01-01" },
        { name: "web-02", createdAtUtc: "2026-01-02" },
        { name: "web-03", createdAtUtc: "2026-01-03" },
      ],
      disabledServers: [{ name: "web-04" }, { name: "web-05" }],
    });
    const args = sendMock.mock.calls[0][0] as { subject: string; html: string; text: string };
    expect(args.subject).toBe("Your servers will be disabled in 3 days");
    expect(args.html).toContain("Hi Alex");
    expect(args.html).toContain("2026-05-12 00:00 UTC");
    expect(args.html).toContain("web-01");
    expect(args.html).toContain("web-04");
    expect(args.text).toContain("web-04");
    expect(args.text).toContain("web-05");
  });
});

describe("sendT1ReminderEmail", () => {
  it("includes only the disabled server list", async () => {
    await sendT1ReminderEmail({
      to: "user@example.com",
      firstName: "Sam",
      gracePeriodEndUtc: "2026-05-09 00:00 UTC",
      disabledServers: [{ name: "web-04" }],
    });
    const args = sendMock.mock.calls[0][0] as { subject: string; html: string };
    expect(args.subject).toBe("Your servers will be disabled tomorrow");
    expect(args.html).toContain("Hi Sam");
    expect(args.html).toContain("2026-05-09 00:00 UTC");
    expect(args.html).toContain("web-04");
  });
});

describe("sendServersDisabledEmail", () => {
  it("subject + body include disabled and kept lists", async () => {
    await sendServersDisabledEmail({
      to: "user@example.com",
      firstName: "Jamie",
      disabledServers: [{ name: "web-04" }, { name: "web-05" }],
      keptServers: [{ name: "web-01" }, { name: "web-02" }, { name: "web-03" }],
    });
    const args = sendMock.mock.calls[0][0] as { subject: string; html: string; text: string };
    expect(args.subject).toBe("Some of your servers have been disabled");
    expect(args.html).toContain("2 of your servers were disabled today");
    expect(args.html).toContain("web-01");
    expect(args.html).toContain("web-04");
    expect(args.text).toContain("Hi Jamie");
    expect(args.text).toContain("Disabled:");
    expect(args.text).toContain("Still active (free quota):");
  });
});

describe("Resend error handling", () => {
  it("sendT1ReminderEmail returns false on Resend error", async () => {
    sendMock.mockResolvedValueOnce({ error: { message: "rate limited" } });
    const ok = await sendT1ReminderEmail({
      to: "user@example.com",
      firstName: "Pat",
      gracePeriodEndUtc: "2026-05-09 00:00 UTC",
      disabledServers: [{ name: "web-04" }],
    });
    expect(ok).toBe(false);
  });

  it("sendT3ReminderEmail returns false on thrown send", async () => {
    sendMock.mockRejectedValueOnce(new Error("network down"));
    const ok = await sendT3ReminderEmail({
      to: "user@example.com",
      firstName: "Pat",
      gracePeriodEndUtc: "2026-05-12 00:00 UTC",
      keptServers: [],
      disabledServers: [{ name: "web-04" }],
    });
    expect(ok).toBe(false);
  });
});

// Restore env for other tests in the same vitest run.
process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY;
