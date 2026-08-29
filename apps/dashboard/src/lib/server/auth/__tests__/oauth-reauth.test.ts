// OAuth step-up re-auth (fix for password-less social accounts locked out of
// API-key creation). The security-critical property: a step-up is satisfied
// ONLY when the returning provider identity resolves to the SAME customer as
// the live session, and it must never mint a session or create an account.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));
vi.mock("../reauth", () => ({ stampReAuth: vi.fn() }));

import { completeOAuthReauth, isReauthIntent } from "../oauth-reauth";
import { query } from "@glassmkr/db/pg";
import { stampReAuth } from "../reauth";

function makeEvent(opts: { customer?: { id: string } | null; cookies?: Record<string, string> }) {
  const store: Record<string, string> = { ...(opts.cookies ?? {}) };
  return {
    locals: { customer: opts.customer ?? undefined },
    cookies: {
      get: (k: string) => store[k],
      set: (k: string, v: string) => { store[k] = v; },
      delete: (k: string) => { delete store[k]; },
    },
  } as any;
}

const q = query as unknown as ReturnType<typeof vi.fn>;
const stamp = stampReAuth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  q.mockReset();
  stamp.mockReset();
});

describe("isReauthIntent", () => {
  it("is true only when oauth_intent=reauth", () => {
    expect(isReauthIntent(makeEvent({ cookies: { oauth_intent: "reauth" } }))).toBe(true);
    expect(isReauthIntent(makeEvent({ cookies: {} }))).toBe(false);
    expect(isReauthIntent(makeEvent({ cookies: { oauth_intent: "login" } }))).toBe(false);
  });
});

describe("completeOAuthReauth", () => {
  it("stamps re-auth when the provider identity is the same customer as the session", async () => {
    q.mockResolvedValue({ rows: [{ customer_id: "cus_1" }] });
    const res = await completeOAuthReauth(makeEvent({ customer: { id: "cus_1" } }), "github", "gh_42", "/settings/keys");
    expect(stamp).toHaveBeenCalledWith("cus_1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings/keys?reauth=ok");
  });

  it("REFUSES (no stamp) when the provider identity is a different customer", async () => {
    q.mockResolvedValue({ rows: [{ customer_id: "cus_2" }] });
    const res = await completeOAuthReauth(makeEvent({ customer: { id: "cus_1" } }), "github", "gh_99", "/settings/keys");
    expect(stamp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/settings/keys?reauth=mismatch");
  });

  it("REFUSES (no stamp) when the provider identity is not linked to any account", async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await completeOAuthReauth(makeEvent({ customer: { id: "cus_1" } }), "google", "goog_x", "/settings/keys");
    expect(stamp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/settings/keys?reauth=mismatch");
  });

  it("sends to /login and never stamps when there is no live session", async () => {
    const res = await completeOAuthReauth(makeEvent({ customer: null }), "github", "gh_1", "/settings/keys");
    expect(stamp).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/login");
  });

  it("rejects an off-origin redirect target and falls back to /settings/keys", async () => {
    q.mockResolvedValue({ rows: [{ customer_id: "cus_1" }] });
    const res = await completeOAuthReauth(makeEvent({ customer: { id: "cus_1" } }), "github", "gh_42", "//evil.example.com/x");
    expect(res.headers.get("location")).toBe("/settings/keys?reauth=ok");
  });

  it("clears the oauth_intent cookie so a later login is not treated as a step-up", async () => {
    q.mockResolvedValue({ rows: [{ customer_id: "cus_1" }] });
    const event = makeEvent({ customer: { id: "cus_1" }, cookies: { oauth_intent: "reauth" } });
    await completeOAuthReauth(event, "github", "gh_42", "/settings/keys");
    expect(isReauthIntent(event)).toBe(false);
  });
});
