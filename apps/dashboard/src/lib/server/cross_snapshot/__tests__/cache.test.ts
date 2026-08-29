// Cache LRU + TTL tests. The cache module is tightly scoped per
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md locked decision 5.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _clearCacheForTests,
  buildCacheKey,
  getFromCache,
  setInCache,
} from "../cache.js";

afterEach(() => {
  _clearCacheForTests();
  vi.useRealTimers();
});

describe("buildCacheKey", () => {
  it("uses a stable form for column order", () => {
    const a = buildCacheKey(
      "h1",
      { fromSecondsAgo: 60 },
      ["disks", "smart"],
      false,
    );
    const b = buildCacheKey(
      "h1",
      { fromSecondsAgo: 60 },
      ["smart", "disks"],
      false,
    );
    expect(a).toBe(b);
  });

  it("distinguishes time vs count windows", () => {
    const time = buildCacheKey("h1", { fromSecondsAgo: 60 }, ["smart"], false);
    const count = buildCacheKey("h1", { count: 6 }, ["smart"], false);
    expect(time).not.toBe(count);
  });

  it("distinguishes parsed flag", () => {
    const raw = buildCacheKey("h1", { count: 6 }, ["smart"], false);
    const parsed = buildCacheKey("h1", { count: 6 }, ["smart"], true);
    expect(raw).not.toBe(parsed);
  });
});

describe("get/set within TTL", () => {
  it("returns cached value on second call", () => {
    setInCache("key", { data: 1 });
    expect(getFromCache<{ data: number }>("key")?.data).toBe(1);
  });

  it("returns null after TTL expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T00:00:00Z"));
    setInCache("key", { data: 1 });
    vi.advanceTimersByTime(61_000);
    expect(getFromCache("key")).toBeNull();
  });
});

describe("LRU eviction at capacity", () => {
  it("evicts insertion-order oldest when at MAX_ENTRIES", () => {
    // The internal cap is 1000; exercising the eviction path directly
    // by filling above the limit.
    for (let i = 0; i < 1001; i++) {
      setInCache(`k${i}`, i);
    }
    expect(getFromCache("k0")).toBeNull();
    expect(getFromCache("k1000")).toBe(1000);
  });
});
