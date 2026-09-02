// P-3 (Grok + Codex security review, 2026-09-01). The public view must NEVER
// return a raw secret, only has_secret + a redacted destination. Test values are
// deliberately low-entropy, obviously-fake placeholders (not secret-shaped).

import { describe, it, expect } from "vitest";
import { publicChannelView } from "../channel-view";

function row(over: Record<string, unknown>) {
  return {
    id: 1,
    channel_type: "webhook",
    name: "n",
    enabled: true,
    priorities: ["P1"],
    created_at: "t",
    config: {},
    ...over,
  } as any;
}

describe("publicChannelView - never leaks a secret", () => {
  it("returns no raw config object and no secret value (pagerduty)", () => {
    const v = publicChannelView(row({ channel_type: "pagerduty", config: { routing_key: "fake-routing-key-000" } }));
    expect((v as any).config).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("fake-routing-key-000");
    expect(v.has_secret).toBe(true);
    expect(v.destination.startsWith("Key ")).toBe(true);
  });

  it("redacts a webhook url to scheme + registrable host, masking a credential subdomain (round-2 #8)", () => {
    const v = publicChannelView(row({ channel_type: "slack", config: { webhook_url: "https://hooks.example.test/services/aaa/bbb/notreal" } }));
    expect(v.destination).toBe("https://•••.example.test/…");
    expect(JSON.stringify(v)).not.toContain("notreal");
  });

  it("masks a token-bearing subdomain so it is not exposed (round-2 #8)", () => {
    const v = publicChannelView(row({ channel_type: "webhook", config: { webhook_url: "https://sekrettoken.hooks.example/path" } }));
    expect(v.destination).toBe("https://•••.hooks.example/…");
    expect(JSON.stringify(v)).not.toContain("sekrettoken");
  });

  it("masks IPv6 and IPv4 literal hosts entirely (round-3 #5)", () => {
    expect(publicChannelView(row({ channel_type: "webhook", config: { webhook_url: "https://[2001:db8::1234]/x" } })).destination).toBe("https://•••/…");
    expect(publicChannelView(row({ channel_type: "webhook", config: { webhook_url: "https://10.0.0.5/hook" } })).destination).toBe("https://•••/…");
  });

  it("keeps the registrable identity of a multi-label host, not just the last two labels (round-3 #5)", () => {
    const v = publicChannelView(row({ channel_type: "webhook", config: { webhook_url: "https://hooks.example.co.uk/x/notreal" } }));
    expect(v.destination).toBe("https://•••.example.co.uk/…");
    expect(JSON.stringify(v)).not.toContain("notreal");
  });

  it("treats the url alias as a secret and redacts it (P-6 leak path)", () => {
    const v = publicChannelView(row({ channel_type: "webhook", config: { url: "https://example.com/hook/notreal" } }));
    expect(v.has_secret).toBe(true);
    expect(v.destination).toBe("https://example.com/…");
    expect(JSON.stringify(v)).not.toContain("notreal");
  });

  it("redacts an email destination", () => {
    expect(publicChannelView(row({ channel_type: "email", config: { to: "alerts@example.com" } })).destination).toBe("al•••@example.com");
  });

  it("redacts a telegram chat id to the last 4", () => {
    expect(publicChannelView(row({ channel_type: "telegram", config: { chat_id: "1234567890" } })).destination).toBe("Chat ••••7890");
  });

  it("has_secret false + empty destination when nothing is configured", () => {
    const v = publicChannelView(row({ channel_type: "webhook", config: {} }));
    expect(v.has_secret).toBe(false);
    expect(v.destination).toBe("");
  });

  it("surfaces notify_minor_update from config", () => {
    expect(publicChannelView(row({ config: { webhook_url: "https://x.io/h", notify_minor_update: true } })).notify_minor_update).toBe(true);
  });
});
