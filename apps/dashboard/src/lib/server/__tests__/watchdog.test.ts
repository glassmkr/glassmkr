import { describe, it, expect } from "vitest";
import {
  findStaleServers,
  effectiveIntervalSeconds,
  buildFixCommands,
  buildUnreachableAlertTitle,
  buildUnreachableAlertMessage,
  DEFAULT_INTERVAL_SECONDS,
  MIN_SERVER_AGE_MS,
  type WatchedServer,
} from "../watchdog";

const NOW = 1_700_000_000_000;

function mkServer(overrides: Partial<WatchedServer> = {}): WatchedServer {
  return {
    id: "srv-1",
    name: "test-1",
    hostname: "test-1",
    ip: "10.0.0.1",
    last_seen_at: new Date(NOW - 15 * 60_000), // 15m ago
    created_at: new Date(NOW - 30 * 60_000),   // 30m old
    config_interval_seconds: null,
    observed_interval_seconds: null,
    ...overrides,
  };
}

describe("findStaleServers", () => {
  it("flags a server that missed 2x its interval", () => {
    const [s] = findStaleServers([mkServer()], NOW);
    expect(s).toBeDefined();
    expect(s.server.id).toBe("srv-1");
    expect(s.minutesSinceLastSeen).toBe(15);
  });

  it("does not flag a server seen within 2x its interval", () => {
    const server = mkServer({ last_seen_at: new Date(NOW - 8 * 60_000) }); // 8m ago, threshold 10m
    expect(findStaleServers([server], NOW)).toHaveLength(0);
  });

  it("does NOT flag a never-reported server still within the install grace", () => {
    const server = mkServer({ last_seen_at: null, created_at: new Date(NOW - 5 * 60_000) }); // 5m old
    expect(findStaleServers([server], NOW)).toHaveLength(0);
  });

  it("flags a never-reported server past the install grace (Grok H-D4a ghost tile)", () => {
    const server = mkServer({ last_seen_at: null, created_at: new Date(NOW - 30 * 60_000) }); // 30m old
    const [s] = findStaleServers([server], NOW);
    expect(s).toBeDefined();
    expect(s.neverReported).toBe(true);
    expect(s.lastSeenMs).toBeNull();
    expect(s.minutesSinceLastSeen).toBe(30);
  });

  it("marks a reported-then-quiet server as neverReported=false", () => {
    const [s] = findStaleServers([mkServer()], NOW);
    expect(s.neverReported).toBe(false);
  });

  it("ignores servers younger than the onboarding grace window", () => {
    const server = mkServer({
      last_seen_at: new Date(NOW - 15 * 60_000),
      created_at: new Date(NOW - MIN_SERVER_AGE_MS + 1000), // just under 10m old
    });
    expect(findStaleServers([server], NOW)).toHaveLength(0);
  });

  it("scales threshold with interval_seconds from config", () => {
    // Customer interval = 600s, so threshold = 1200s = 20 minutes.
    const sparse = mkServer({ config_interval_seconds: 600, last_seen_at: new Date(NOW - 15 * 60_000) });
    expect(findStaleServers([sparse], NOW)).toHaveLength(0);

    const sparseBroken = mkServer({ config_interval_seconds: 600, last_seen_at: new Date(NOW - 25 * 60_000) });
    expect(findStaleServers([sparseBroken], NOW)).toHaveLength(1);
  });

  it("falls back to default interval when config is 0/missing", () => {
    const s = mkServer({ config_interval_seconds: 0, last_seen_at: new Date(NOW - 15 * 60_000) });
    expect(findStaleServers([s], NOW)).toHaveLength(1);
  });

  it("uses the observed cadence when no config override is set", () => {
    // Fast agent (60s measured): flagged after 5 minutes instead of waiting
    // out the 300s default's 10-minute threshold.
    const fastGone = mkServer({ observed_interval_seconds: 60, last_seen_at: new Date(NOW - 5 * 60_000) });
    expect(findStaleServers([fastGone], NOW)).toHaveLength(1);

    // Same fast agent seen 90s ago: inside its 2x60s threshold, not stale.
    const fastFine = mkServer({ observed_interval_seconds: 60, last_seen_at: new Date(NOW - 90_000) });
    expect(findStaleServers([fastFine], NOW)).toHaveLength(0);

    // Slow agent (1800s measured): 15 minutes of silence is normal for it.
    const slow = mkServer({ observed_interval_seconds: 1800, last_seen_at: new Date(NOW - 15 * 60_000) });
    expect(findStaleServers([slow], NOW)).toHaveLength(0);
  });

  it("config override beats the observed cadence", () => {
    // Operator pinned 600s; a 60s measured cadence must not tighten the
    // threshold below the explicit override (15m < 2x600s = 20m).
    const s = mkServer({
      config_interval_seconds: 600,
      observed_interval_seconds: 60,
      last_seen_at: new Date(NOW - 15 * 60_000),
    });
    expect(findStaleServers([s], NOW)).toHaveLength(0);
  });

  it("effectiveIntervalSeconds precedence: config, observed, default", () => {
    expect(effectiveIntervalSeconds(mkServer({ config_interval_seconds: 600, observed_interval_seconds: 60 }))).toBe(600);
    expect(effectiveIntervalSeconds(mkServer({ observed_interval_seconds: 60 }))).toBe(60);
    expect(effectiveIntervalSeconds(mkServer())).toBe(DEFAULT_INTERVAL_SECONDS);
    // Zero/garbage values fall through rather than yielding a 0s threshold.
    expect(effectiveIntervalSeconds(mkServer({ config_interval_seconds: 0, observed_interval_seconds: 0 }))).toBe(DEFAULT_INTERVAL_SECONDS);
  });

  it("handles multiple servers at once", () => {
    const ok = mkServer({ id: "ok", last_seen_at: new Date(NOW - 2 * 60_000) });
    const stale = mkServer({ id: "stale", last_seen_at: new Date(NOW - 30 * 60_000) });
    const res = findStaleServers([ok, stale], NOW);
    expect(res.map((s) => s.server.id)).toEqual(["stale"]);
  });
});

describe("buildFixCommands", () => {
  it("uses IP when available", () => {
    const cmds = buildFixCommands(mkServer({ ip: "10.0.0.99" }));
    expect(cmds.some((c) => c.includes("ping -c 3 10.0.0.99"))).toBe(true);
    expect(cmds.some((c) => c.includes("ssh 10.0.0.99"))).toBe(true);
    expect(cmds.some((c) => c.includes("glassmkr-crucible"))).toBe(true);
  });
  it("falls back to hostname when IP missing", () => {
    const cmds = buildFixCommands(mkServer({ ip: null, hostname: "web-01" }));
    expect(cmds.some((c) => c.includes("web-01"))).toBe(true);
  });
  it("uses <server> placeholder when neither IP nor hostname is known", () => {
    const cmds = buildFixCommands(mkServer({ ip: null, hostname: null }));
    expect(cmds.some((c) => c.includes("<server>"))).toBe(true);
  });
});

describe("alert copy", () => {
  it("title mentions minutes", () => {
    expect(buildUnreachableAlertTitle(24)).toContain("24 minutes");
  });
  it("message mentions last-seen timestamp", () => {
    const msg = buildUnreachableAlertMessage(mkServer(), NOW - 15 * 60_000);
    expect(msg).toContain("Last snapshot received at");
    expect(msg).toContain("Crucible may have stopped");
  });
});
