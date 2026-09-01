// P-1 (Grok + Codex security review, 2026-09-01). POST logout must revoke the
// browser session (stamp browser_session_epoch) so a captured guardian_token
// stops validating; GET must clear cookies but NOT stamp the epoch (a GET can be
// triggered cross-site and a forced GLOBAL logout would be a nuisance CSRF).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import { POST, GET } from "../+server";

function fakeEvent(customerId: string | null) {
  const deleted: string[] = [];
  return {
    locals: { customer: customerId ? { id: customerId } : null },
    cookies: { delete: (name: string) => deleted.push(name) },
    _deleted: deleted,
  } as any;
}

async function caught(p: any): Promise<any> {
  try {
    await p;
    return null;
  } catch (e) {
    return e; // SvelteKit redirect(302) is thrown
  }
}

beforeEach(() => {
  (query as any).mockReset();
  (query as any).mockResolvedValue({ rows: [] });
});

describe("logout", () => {
  it("POST stamps browser_session_epoch for the live customer and redirects", async () => {
    const ev = fakeEvent("cust_1");
    const redir = await caught(POST(ev));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("browser_session_epoch = NOW()"),
      ["cust_1"],
    );
    expect(redir?.status).toBe(302);
    expect(ev._deleted).toContain("guardian_token");
    expect(ev._deleted).toContain("gmk_signed_in");
  });

  it("POST without a resolved session clears cookies but stamps nothing", async () => {
    const ev = fakeEvent(null);
    await caught(POST(ev));
    expect(query).not.toHaveBeenCalled();
    expect(ev._deleted).toContain("guardian_token");
  });

  it("GET clears cookies but never stamps the epoch (no forced global logout)", async () => {
    const ev = fakeEvent("cust_1");
    const redir = await caught(GET(ev));
    expect(query).not.toHaveBeenCalled();
    expect(redir?.status).toBe(302);
    expect(ev._deleted).toContain("guardian_token");
  });
});
