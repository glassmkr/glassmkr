import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A caller handed a health snapshot cannot tell whether it arrived a minute ago
// or a day ago, and the two support opposite decisions. A human has the
// dashboard's "last seen" beside it; an agent has only the payload. So the
// response states its own age.
//
// The timezone case is the one worth pinning: ClickHouse returns naive
// timestamps with no zone, and reading one with `new Date()` on a machine that
// is not UTC invents an offset. This project has already shipped that bug once,
// where a staleness figure suspiciously equal to the local UTC offset turned out
// to be the reader's clock rather than the data.
const SRC = fs.readFileSync(
  path.join(__dirname, "..", "fleet-read.ts"),
  "utf8",
);

describe("the health response states its own freshness", () => {
  it("returns a freshness block alongside the snapshot", () => {
    expect(SRC).toMatch(/freshness: freshnessOf\(snapshot\)/);
  });

  it("normalises a naive ClickHouse timestamp to UTC before measuring age", () => {
    // Without this, a non-UTC reader fabricates hours of staleness.
    expect(SRC).toMatch(/endsWith\("Z"\)/);
  });

  it("treats an unreadable timestamp as stale rather than as fresh", () => {
    // Failing open here would mean a snapshot with a broken timestamp is
    // reported as current, which is the dangerous direction.
    expect(SRC).toMatch(/observed_at: null, age_seconds: null, stale: true/);
  });

  it("uses the same staleness threshold the fleet table uses", () => {
    expect(SRC).toMatch(/STALE_AFTER_SECONDS = 15 \* 60/);
  });

  it("publishes the threshold so a caller can apply its own", () => {
    // A boolean alone forces every consumer to accept our definition of stale.
    expect(SRC).toMatch(/stale_after_seconds: STALE_AFTER_SECONDS/);
  });
});

describe("freshness arithmetic", () => {
  // Exercised through a local copy of the same logic, because the real function
  // is module-private and reaching it would mean standing up ClickHouse. The
  // assertions above pin that the shipped code has these properties; these pin
  // that the properties produce the right numbers.
  const STALE_AFTER_SECONDS = 15 * 60;
  function freshnessOf(raw: string | null, now: number) {
    const observedAt = raw ? new Date(String(raw).endsWith("Z") ? String(raw) : `${raw}Z`) : null;
    if (!observedAt || Number.isNaN(observedAt.getTime())) {
      return { observed_at: null, age_seconds: null, stale: true, stale_after_seconds: STALE_AFTER_SECONDS };
    }
    const age = Math.max(0, Math.round((now - observedAt.getTime()) / 1000));
    return { observed_at: observedAt.toISOString(), age_seconds: age, stale: age > STALE_AFTER_SECONDS, stale_after_seconds: STALE_AFTER_SECONDS };
  }

  const NOW = Date.parse("2026-08-28T12:00:00.000Z");

  it("reads a naive timestamp as UTC, not as local time", () => {
    // The bug this exists to prevent: on a UTC+2 machine, reading
    // "2026-08-28 11:58:00" as local time yields an age of about two hours.
    const f = freshnessOf("2026-08-28 11:58:00", NOW);
    expect(f.age_seconds).toBe(120);
    expect(f.stale).toBe(false);
  });

  it("marks a snapshot older than three collection intervals as stale", () => {
    expect(freshnessOf("2026-08-28 11:44:00", NOW).stale).toBe(true);
    expect(freshnessOf("2026-08-28 11:46:00", NOW).stale).toBe(false);
  });

  it("never reports a negative age when a host clock runs ahead", () => {
    const f = freshnessOf("2026-08-28 12:05:00", NOW);
    expect(f.age_seconds).toBe(0);
    expect(f.stale).toBe(false);
  });

  it("treats a missing or unparseable timestamp as stale", () => {
    for (const bad of [null, "", "not-a-date"]) {
      const f = freshnessOf(bad as string | null, NOW);
      expect(f.stale).toBe(true);
      expect(f.age_seconds).toBeNull();
    }
  });
});
