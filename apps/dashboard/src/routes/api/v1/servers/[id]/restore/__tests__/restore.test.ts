// Route-level tests for POST /api/v1/servers/{id}/restore.
//
// Mock surface mirrors the existing security.test.ts pattern: DB, Redis
// (degrade-open), Stripe SDK, billing-sync. Auth helpers (`requireAuth`,
// `requireServerOwnership`) are mocked to a known-good principal so we
// exercise restore-specific behaviour, not the broader auth path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => {
  const queryFn = vi.fn();
  return { query: queryFn };
});
vi.mock("$lib/server/redis", () => ({
  getRedis: () => null,
  setRedisForTests: () => {},
  quitRedis: async () => {},
}));
vi.mock("$lib/server/auth/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("$lib/server/auth/rate-limit-middleware", () => ({
  enforceIpRateLimit: async () => null,
  rateLimitedResponse: () => new Response("rate-limited", { status: 429 }),
}));
vi.mock("$lib/server/auth/require", () => ({
  requireAuth: async () => ({
    kind: "session",
    customer_id: "cust-1",
    email: "x@y.z",
    plan: "pro",
  }),
}));
vi.mock("$lib/server/authz", () => ({
  requireServerOwnership: vi.fn(async () => undefined),
}));

const stripeRetrieve = vi.fn();
vi.mock("$lib/server/billing/stripe", () => ({
  stripe: { customers: { retrieve: (...args: unknown[]) => stripeRetrieve(...args) } },
  isStripeConfigured: () => true,
}));

import { query } from "@glassmkr/db/pg";
import { POST } from "../+server.js";

let originalFlag: string | undefined;

beforeEach(() => {
  (query as any).mockReset();
  stripeRetrieve.mockReset();
  originalFlag = process.env.BILLING_ENFORCEMENT_ENABLED;
  delete process.env.BILLING_ENFORCEMENT_ENABLED;
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED;
  else process.env.BILLING_ENFORCEMENT_ENABLED = originalFlag;
  vi.clearAllMocks();
});

function makeEvent(serverId: string): any {
  return {
    request: {
      method: "POST",
      url: `https://dashboard.test/api/v1/servers/${serverId}/restore`,
      headers: { get: (n: string) => (n.toLowerCase() === "user-agent" ? "test/1" : null) },
      json: async () => ({}),
    },
    locals: { customer: { id: "cust-1", email: "x", plan: "pro" } },
    params: { id: serverId },
    url: new URL(`https://dashboard.test/api/v1/servers/${serverId}/restore`),
    getClientAddress: () => "10.0.0.1",
    route: { id: "/api/v1/servers/[id]/restore" },
  };
}

describe("POST /servers/:id/restore", () => {
  it("flag OFF: returns 503 for a suspended (billing) server; no DB writes", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    // The route now fetches the server before the billing-flag short-circuit (so
    // a soft-deleted server can be un-deleted regardless of the flag). A suspended
    // server falls through to the 503; only the read runs, no UPDATE.
    (query as any).mockResolvedValueOnce({ rows: [
      { id: "srv_1", name: "mine", status: "suspended", suspended_at: new Date(), suspended_reason: "no_card_on_file" },
    ]});
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toContain("Billing enforcement not yet active");
    const calls = (query as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((sql: string) => /UPDATE/i.test(sql))).toBe(false);
  });

  it("flag ON + exempt customer + suspended: bypasses Stripe check, restores directly", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [
        { id: "srv_1", name: "mine", status: "suspended", suspended_at: new Date(), suspended_reason: "no_card_on_file" },
      ]})
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x", billing_enforcement_exempt: true }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.server.status).toBe("active");
    // Stripe.customers.retrieve must NOT have been called for exempt path.
    expect(stripeRetrieve).not.toHaveBeenCalled();
    const updateCall = (query as any).mock.calls.find((c: any[]) => String(c[0]).includes("UPDATE servers"));
    expect(updateCall).toBeTruthy();
    expect(String(updateCall[0])).toContain("status = 'active'");
  });

  it("flag ON + server already active: idempotent 200", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any).mockResolvedValueOnce({ rows: [
      { id: "srv_1", name: "mine", status: "active", suspended_at: null, suspended_reason: null },
    ]});
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.already_active).toBe(true);
    // Only the SELECT was issued; no UPDATE.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("flag ON + suspended + Stripe shows card: clears suspension, returns 200", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [
        { id: "srv_1", name: "mine", status: "suspended", suspended_at: new Date(), suspended_reason: "no_card_on_file" },
      ]})
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x" }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    stripeRetrieve.mockResolvedValueOnce({
      deleted: false,
      invoice_settings: { default_payment_method: { id: "pm_y" } },
    });
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.server.status).toBe("active");
    const updateCall = (query as any).mock.calls.find((c: any[]) => String(c[0]).includes("UPDATE servers"));
    expect(updateCall).toBeTruthy();
    expect(String(updateCall[0])).toContain("suspended_at = NULL");
    expect(String(updateCall[0])).toContain("status = 'active'");
  });

  it("flag ON + suspended + Stripe shows NO card: 400 with no_card_on_file error", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [
        { id: "srv_1", name: "mine", status: "suspended", suspended_at: new Date(), suspended_reason: "no_card_on_file" },
      ]})
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x" }] });
    stripeRetrieve.mockResolvedValueOnce({
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("no_card_on_file");
    // No UPDATE issued.
    const updateCall = (query as any).mock.calls.find((c: any[]) => String(c[0]).includes("UPDATE servers"));
    expect(updateCall).toBeFalsy();
  });

  it("flag ON + suspended + customer has no stripe_customer_id: 400", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [
        { id: "srv_1", name: "mine", status: "suspended", suspended_at: new Date(), suspended_reason: "no_card_on_file" },
      ]})
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: null }] });
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("no_stripe_customer");
  });

  it("flag ON + Stripe lookup throws: 502 (don't restore on transient error)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [
        { id: "srv_1", name: "mine", status: "suspended", suspended_at: new Date(), suspended_reason: "no_card_on_file" },
      ]})
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x" }] });
    stripeRetrieve.mockRejectedValueOnce(new Error("stripe down"));
    const resp = await POST(makeEvent("srv_1"));
    expect(resp.status).toBe(502);
  });

  it("flag ON + server not found: 404", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any).mockResolvedValueOnce({ rows: [] });
    const resp = await POST(makeEvent("srv_missing"));
    expect(resp.status).toBe(404);
  });
});
