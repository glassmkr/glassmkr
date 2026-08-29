// Read-only demo access policy. The key regression this guards (Codex review
// 2026-06-06 finding P2): GET /api/v1/billing/checkout is a side-effecting GET
// (it creates a Stripe customer + checkout session and writes
// customers.stripe_customer_id). A method-only guard let a demo session reach
// it. demoDisposition must classify it as block-get while leaving read-only
// GETs (including billing/status) untouched.

import { describe, it, expect } from "vitest";
import { demoDisposition } from "../demo-access";

describe("demoDisposition", () => {
  it("allows read-only browsing GETs", () => {
    expect(demoDisposition("GET", "/")).toBe("allow");
    expect(demoDisposition("GET", "/api/v1/servers")).toBe("allow");
    expect(demoDisposition("GET", "/api/v1/servers/abc123")).toBe("allow");
    expect(demoDisposition("GET", "/api/v1/billing/status")).toBe("allow");
    expect(demoDisposition("HEAD", "/api/v1/servers")).toBe("allow");
    expect(demoDisposition("OPTIONS", "/api/v1/servers")).toBe("allow");
  });

  it("blocks the side-effecting checkout GET (writes + creates Stripe objects)", () => {
    expect(demoDisposition("GET", "/api/v1/billing/checkout")).toBe("block-get");
  });

  // The demo is a shared tenant, so its audit rows are written by whoever is
  // browsing right now, and each row carries source_ip and user_agent. Reading
  // it meant reading other visitors. Found by an external audit of the live
  // demo, confirmed against production before fixing.
  it("blocks the audit log for demo sessions, API and page alike", () => {
    expect(demoDisposition("GET", "/api/v1/account/audit")).toBe("block-get");
    expect(demoDisposition("GET", "/settings/audit")).toBe("block-get");
  });

  it("blocks state-changing methods that are not the lead endpoint", () => {
    expect(demoDisposition("POST", "/api/v1/servers")).toBe("block-mutation");
    expect(demoDisposition("DELETE", "/api/v1/servers/abc123")).toBe("block-mutation");
    expect(demoDisposition("PATCH", "/api/v1/servers/abc123")).toBe("block-mutation");
    // checkout POST is also blocked (the demo only ever browses)
    expect(demoDisposition("POST", "/api/v1/billing/checkout")).toBe("block-mutation");
  });

  it("allows the unauthenticated demo lead-capture POST", () => {
    expect(demoDisposition("POST", "/api/v1/demo/lead")).toBe("allow");
  });

  it("allows the ticket-draft POST (read-scoped, no customer-state mutation)", () => {
    expect(demoDisposition("POST", "/api/v1/servers/abc123/alerts/42/ticket-draft")).toBe("allow");
  });

  it("does not let the ticket-draft pattern widen other server mutations", () => {
    // The pattern is anchored to the exact /ticket-draft suffix: a neighbouring
    // alert mutation (ack/mute/resolve) or any other suffix stays blocked.
    expect(demoDisposition("POST", "/api/v1/servers/abc123/alerts/42/ack")).toBe("block-mutation");
    expect(demoDisposition("POST", "/api/v1/servers/abc123/alerts/42/ticket-draft/extra")).toBe("block-mutation");
    expect(demoDisposition("DELETE", "/api/v1/servers/abc123/alerts/42/ticket-draft")).toBe("block-mutation");
  });
});
