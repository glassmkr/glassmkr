import { describe, it, expect, beforeEach, vi } from "vitest";
import { deriveOverall, probeService, type ServiceState } from "../server/state";
import type { PublicService } from "../services";

const svc: PublicService = { id: "dashboard", name: "Dashboard", description: "test", url: "https://example.test/" };

function mkState(status: "operational" | "outage"): ServiceState {
  return { service: svc, status, checkedAtIso: new Date().toISOString(), responseMs: 0 };
}

describe("deriveOverall", () => {
  it("is outage when list is empty", () => {
    expect(deriveOverall([])).toBe("outage");
  });
  it("is operational when all up", () => {
    expect(deriveOverall([mkState("operational"), mkState("operational")])).toBe("operational");
  });
  it("is outage when all down", () => {
    expect(deriveOverall([mkState("outage"), mkState("outage")])).toBe("outage");
  });
  it("is partial_outage when some down", () => {
    expect(deriveOverall([mkState("operational"), mkState("outage")])).toBe("partial_outage");
  });
});

describe("probeService", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = realFetch; });

  it("returns operational on 200", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const res = await probeService(svc);
    expect(res.status).toBe("operational");
    expect(res.responseMs).not.toBeNull();
  });
  it("returns operational on 3xx (follows redirects)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 301 })) as typeof fetch;
    const res = await probeService(svc);
    // 301 < 400, so operational
    expect(res.status).toBe("operational");
  });
  it("returns outage on 500", async () => {
    globalThis.fetch = vi.fn(async () => new Response("err", { status: 500 })) as typeof fetch;
    const res = await probeService(svc);
    expect(res.status).toBe("outage");
  });
  it("returns outage on network error", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ENOTFOUND"); }) as typeof fetch;
    const res = await probeService(svc);
    expect(res.status).toBe("outage");
    expect(res.responseMs).toBeNull();
  });
});
