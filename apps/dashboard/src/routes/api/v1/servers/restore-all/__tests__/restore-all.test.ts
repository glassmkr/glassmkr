// Route-level tests for POST /api/v1/servers/restore-all.
// Mirrors the per-server restore tests; exercises the bulk flow:
// 503 flag-off, 400 no-card, 400 no-stripe-customer, 502 stripe-error,
// 200 happy path, exempt-bypass, no-suspended-servers idempotent.

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

function makeEvent(): any {
  return {
    request: {
      method: "POST",
      url: `https://dashboard.test/api/v1/servers/restore-all`,
      headers: { get: (n: string) => (n.toLowerCase() === "user-agent" ? "test/1" : null) },
      json: async () => ({}),
    },
    locals: { customer: { id: "cust-1", email: "x", plan: "pro" } },
    params: {},
    url: new URL(`https://dashboard.test/api/v1/servers/restore-all`),
    getClientAddress: () => "10.0.0.1",
    route: { id: "/api/v1/servers/restore-all" },
  };
}

describe("POST /servers/restore-all", () => {
  it("flag OFF: returns 503 with explanatory message; no DB writes", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toContain("Billing enforcement not yet active");
    expect(query).not.toHaveBeenCalled();
  });

  it("flag ON + no suspended servers: 200 idempotent (no UPDATE)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x", billing_enforcement_exempt: false }] })
      .mockResolvedValueOnce({ rows: [] }); // no suspended servers
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.restored).toEqual([]);
    expect(body.already_active).toBe(true);
    // SELECT customer + SELECT suspended servers, no UPDATE
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("flag ON + suspended + Stripe shows card: bulk UPDATE + 200 with restored list", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    const suspended = [
      { id: "s1", name: "alpha" },
      { id: "s2", name: "beta" },
      { id: "s3", name: "gamma" },
    ];
    (query as any)
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x", billing_enforcement_exempt: false }] })
      .mockResolvedValueOnce({ rows: suspended })
      .mockResolvedValueOnce({ rows: suspended }); // bulk UPDATE RETURNING
    stripeRetrieve.mockResolvedValueOnce({
      deleted: false,
      invoice_settings: { default_payment_method: { id: "pm_y" } },
    });
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(3);
    expect(body.restored.map((s: any) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(body.message).toBe("3 servers restored.");
    // Confirm the UPDATE SQL is bulk + filtered by reason
    const updateCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE servers") && String(c[0]).includes("SET status = 'active'")
    );
    expect(updateCall).toBeTruthy();
    expect(String(updateCall[0])).toContain("suspended_reason = 'no_card_on_file'");
    expect(String(updateCall[0])).toContain("RETURNING id, name");
  });

  it("flag ON + suspended + Stripe shows NO card: 400 no_card_on_file (clickable error msg)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x", billing_enforcement_exempt: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "s1", name: "alpha" }] });
    stripeRetrieve.mockResolvedValueOnce({
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("no_card_on_file");
    expect(body.message).toContain("Add a payment method");
    // No UPDATE issued
    const updateCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE servers") && String(c[0]).includes("SET status = 'active'")
    );
    expect(updateCall).toBeFalsy();
  });

  it("flag ON + exempt customer: bypasses Stripe + bulk-restores", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    const suspended = [
      { id: "s1", name: "alpha" },
      { id: "s2", name: "beta" },
    ];
    (query as any)
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x", billing_enforcement_exempt: true }] })
      .mockResolvedValueOnce({ rows: suspended })
      .mockResolvedValueOnce({ rows: suspended });
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    // Stripe MUST NOT have been called for exempt path
    expect(stripeRetrieve).not.toHaveBeenCalled();
  });

  it("flag ON + Stripe lookup throws: 502", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_x", billing_enforcement_exempt: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "s1", name: "alpha" }] });
    stripeRetrieve.mockRejectedValueOnce(new Error("stripe down"));
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(502);
  });

  it("flag ON + customer with no stripe_customer_id: 400 no_stripe_customer", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    (query as any)
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: null, billing_enforcement_exempt: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "s1", name: "alpha" }] });
    const resp = await POST(makeEvent());
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("no_stripe_customer");
  });
});
