// Unit tests for the per-node subscription quantity sync helper.
//
// Verifies the state machine (no-op, REFUSED creation, updated, cancelled)
// without hitting Postgres or Stripe. Both are mocked.
//
// The refusal tests are the known-bad regression for the retired paid tier
// (P0-03): the pre-2026-08-29 code CREATED a Stripe subscription in the
// billable>0/no-sub state, so these tests fail against it. If they ever fail
// again, the no-new-subscriptions contract (checkout 410, Terms section 6)
// has regressed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const stripeCreate = vi.fn();
const stripeUpdate = vi.fn();
const stripeCancel = vi.fn();
const stripeRetrieve = vi.fn();

vi.mock("../stripe", () => ({
  stripe: {
    subscriptions: {
      create: (...args: unknown[]) => stripeCreate(...args),
      update: (...args: unknown[]) => stripeUpdate(...args),
      cancel: (...args: unknown[]) => stripeCancel(...args),
      retrieve: (...args: unknown[]) => stripeRetrieve(...args),
    },
  },
  PRICES: { pro: "price_test_pro" },
}));

const { syncSubscriptionQuantity } = await import("../sync");

function mockCustomer(row: Record<string, unknown> | null) {
  queryMock.mockResolvedValueOnce({ rows: row ? [row] : [] });
}
function mockNodeCount(n: number) {
  queryMock.mockResolvedValueOnce({ rows: [{ n }] });
}

describe("syncSubscriptionQuantity", () => {
  beforeEach(() => {
    queryMock.mockReset();
    stripeCreate.mockReset();
    stripeUpdate.mockReset();
    stripeCancel.mockReset();
    stripeRetrieve.mockReset();
  });

  it("is a no-op for free customers", async () => {
    mockCustomer({ plan: "free", stripe_customer_id: "cus_x", stripe_subscription_id: null });
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("none");
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(stripeCancel).not.toHaveBeenCalled();
  });

  it("skips when customer not found", async () => {
    mockCustomer(null);
    const r = await syncSubscriptionQuantity("cust-missing");
    expect(r.action).toBe("skipped");
  });

  it("skips when no stripe customer id", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: null, stripe_subscription_id: null });
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("skipped");
    expect(r.reason).toContain("stripe customer");
  });

  it("does nothing when Pro customer has 0 active nodes and no sub", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: "cus_x", stripe_subscription_id: null });
    mockNodeCount(0);
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("none");
    expect(r.billable).toBe(0);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("cancels existing sub (with proration) when Pro customer's nodes drop to 0", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: "cus_x", stripe_subscription_id: "sub_123" });
    mockNodeCount(0);
    stripeCancel.mockResolvedValueOnce({ id: "sub_123", status: "canceled" });
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE customers
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("cancelled");
    expect(r.subscriptionId).toBeNull();
    expect(stripeCancel).toHaveBeenCalledWith("sub_123", { prorate: true });
  });

  it("refuses to create a subscription for a legacy Pro customer with nodes and no sub", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: "cus_x", stripe_subscription_id: null });
    mockNodeCount(1);
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("skipped");
    expect(r.reason).toContain("retired");
    expect(r.subscriptionId).toBeNull();
    expect(stripeCreate).not.toHaveBeenCalled();
    // Exactly the two reads ran; nothing wrote a subscription id back.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("refuses creation at every node count, not only one", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: "cus_x", stripe_subscription_id: null });
    mockNodeCount(5);
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("skipped");
    expect(r.billable).toBe(5);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("updates sub quantity (with proration) when node count changes", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: "cus_x", stripe_subscription_id: "sub_123" });
    mockNodeCount(7);
    stripeRetrieve.mockResolvedValueOnce({
      id: "sub_123",
      items: { data: [{ id: "si_1", quantity: 4 }] },
    });
    stripeUpdate.mockResolvedValueOnce({ id: "sub_123" });
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("updated");
    expect(r.billable).toBe(7);
    const updateArg = stripeUpdate.mock.calls[0][1];
    expect(updateArg.items[0].quantity).toBe(7);
    expect(updateArg.items[0].id).toBe("si_1");
    expect(updateArg.proration_behavior).toBe("create_prorations");
  });

  it("does nothing when sub quantity already matches node count", async () => {
    mockCustomer({ plan: "pro", stripe_customer_id: "cus_x", stripe_subscription_id: "sub_123" });
    mockNodeCount(5);
    stripeRetrieve.mockResolvedValueOnce({
      id: "sub_123",
      items: { data: [{ id: "si_1", quantity: 5 }] },
    });
    const r = await syncSubscriptionQuantity("cust-1");
    expect(r.action).toBe("none");
    expect(stripeUpdate).not.toHaveBeenCalled();
  });


});
