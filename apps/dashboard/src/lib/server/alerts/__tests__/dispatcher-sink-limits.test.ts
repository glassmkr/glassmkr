// Host-derived alert text must be clamped to what each notification sink
// accepts. Codex review 2026-09-04 #2: `firewall.details` (and any other
// host-supplied string that reaches alert.message) has no sink-appropriate cap,
// so a 3,001-character details string produced a Slack section over the
// 3,000-character block limit and a failed delivery that the dispatcher still
// marked notification_sent. The JSON boundary only rejects strings over 64 KiB,
// which is far above every chat sink's limit. Discord already clamps; Slack and
// Telegram did not.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock("@glassmkr/db/clickhouse", () => ({ clickhouse: { insert: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../email", () => ({ sendEmail: vi.fn() }));
vi.mock("../context", () => ({ buildContextBlock: async () => null }));
vi.mock("$lib/server/auth/rate-limit", () => ({ take: () => true, TIER_WEBHOOK_SEND: {} }));

const safeFetchMock = vi.fn();
vi.mock("$lib/server/net/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

const { dispatchNotifications } = await import("../dispatcher");
const { clampForSink } = await import("../notify-utils");

const fetchMock = vi.fn();
let originalToken: string | undefined;

beforeEach(() => {
  queryMock.mockReset();
  safeFetchMock.mockReset();
  fetchMock.mockReset();
  safeFetchMock.mockResolvedValue({ ok: true, status: 200 });
  fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => null } });
  vi.stubGlobal("fetch", fetchMock);
  originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
});

function arrangeChannels() {
  queryMock.mockResolvedValueOnce({ rows: [{
    id: "srv_1", name: "x", hostname: "h", ip: "1.1.1.1", customer_id: "cust-1", status: "active",
    os_id: "ubuntu", os_id_like: null, os_version_id: "24.04", dmi_vendor: null,
  }]});
  queryMock.mockResolvedValueOnce({ rows: [
    { id: 1, channel_type: "slack", name: "s", config: { webhook_url: "https://hooks.slack.com/services/T/B/x" }, priorities: ["P1", "P2", "P3", "P4"] },
    { id: 2, channel_type: "telegram", name: "t", config: { chat_id: "123" }, priorities: ["P1", "P2", "P3", "P4"] },
  ]});
  queryMock.mockResolvedValue({ rows: [] });
}

// A no_firewall alert whose message carries an oversized host-supplied details
// string, the shape a hostile or broken agent can send.
const hugeAlert = {
  id: 7,
  alert_type: "no_firewall",
  severity: "warning",
  title: "No firewall active " + "&".repeat(300),
  message: `No active firewall rules detected (checked ${"ufw: inactive; ".repeat(400)}). All ports are exposed unless protected by network-level ACLs.`,
  evidence: { source: "ufw" },
  recommendation: "Enable a firewall.",
};

describe("notification sink length limits", () => {
  it("clamps the Slack header to 150 and the message section to 3000 characters", async () => {
    arrangeChannels();
    await dispatchNotifications("srv_1", [hugeAlert], []);
    const slackCall = safeFetchMock.mock.calls.find((c) => String(c[0]).includes("hooks.slack.com"));
    expect(slackCall).toBeDefined();
    const body = JSON.parse((slackCall![1] as any).body);
    const blocks = body.attachments[0].blocks;
    const header = blocks.find((b: any) => b.type === "header");
    const section = blocks.find((b: any) => b.type === "section" && b.text);
    expect(header.text.text.length).toBeLessThanOrEqual(150);
    expect(section.text.text.length).toBeLessThanOrEqual(3000);
    // The clamp must not leave a dangling half-entity from the mrkdwn escaping.
    expect(section.text.text).not.toMatch(/&(?:amp|am|a|lt|l|gt|g)?\.\.\.$/);
  });

  it("clampForSink drops a partial HTML entity split by the cut", () => {
    // 2996 x + "&amp;zz" is 3003 chars; a naive cut at 2997 ends in a bare "&".
    const out = clampForSink("x".repeat(2996) + "&amp;zz", 3000);
    expect(out.length).toBeLessThanOrEqual(3000);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("&");
    expect(clampForSink("short", 3000)).toBe("short");
  });

  it("keeps every Telegram sendMessage text within the 4096-character API limit", async () => {
    arrangeChannels();
    await dispatchNotifications("srv_1", [hugeAlert], []);
    const telegramCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("api.telegram.org"));
    expect(telegramCalls.length).toBeGreaterThan(0);
    for (const call of telegramCalls) {
      const text = JSON.parse((call[1] as any).body).text as string;
      expect(text.length).toBeLessThanOrEqual(4096);
      // HTML parse mode rejects a truncated entity; the clamp must cut cleanly.
      expect(text).not.toMatch(/&[a-z]*\.\.\.\n/);
    }
  });
});
