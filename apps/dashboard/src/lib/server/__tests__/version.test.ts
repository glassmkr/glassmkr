import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLatestCrucible, FALLBACK_LATEST, _resetLatestCrucibleCache } from "../version";

// Each test starts with a clean cache and its own fetch mock. Cache TTL is
// 10 minutes, so tests that call getLatestCrucible() twice without resetting
// would see the cached value from the first call - call _resetLatestCrucibleCache
// between assertions that need a fresh fetch.
beforeEach(() => {
  _resetLatestCrucibleCache();
  vi.restoreAllMocks();
});
afterEach(() => {
  _resetLatestCrucibleCache();
});

describe("getLatestCrucible", () => {
  it("returns the version from npm dist-tags.latest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ latest: "0.8.1" }), { status: 200 }),
    );
    expect(await getLatestCrucible()).toBe("0.8.1");
  });

  it("strips a leading v from the npm value (defensive)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ latest: "v0.7.2" }), { status: 200 }),
    );
    expect(await getLatestCrucible()).toBe("0.7.2");
  });

  it("falls back to the constant when npm returns non-OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not found", { status: 404 }),
    );
    expect(await getLatestCrucible()).toBe(FALLBACK_LATEST);
  });

  it("falls back to the constant on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await getLatestCrucible()).toBe(FALLBACK_LATEST);
  });

  it("falls back when npm 'latest' is not semver", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ latest: "nightly-20260422" }), { status: 200 }),
    );
    expect(await getLatestCrucible()).toBe(FALLBACK_LATEST);
  });

  it("caches within the TTL window (second call does not re-fetch)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ latest: "0.9.0" }), { status: 200 }),
    );
    expect(await getLatestCrucible()).toBe("0.9.0");
    expect(await getLatestCrucible()).toBe("0.9.0");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent callers onto a single in-flight fetch", async () => {
    let resolve!: (r: Response) => void;
    const promise = new Promise<Response>((r) => { resolve = r; });
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(promise as any);
    const p1 = getLatestCrucible();
    const p2 = getLatestCrucible();
    resolve(new Response(JSON.stringify({ latest: "0.9.1" }), { status: 200 }));
    expect(await p1).toBe("0.9.1");
    expect(await p2).toBe("0.9.1");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
