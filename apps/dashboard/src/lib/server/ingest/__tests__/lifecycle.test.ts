import { describe, it, expect } from "vitest";
import {
  isRateLimited,
  isPlausibleApiKey,
  parseOsString,
  snapshotToClickhouseRow,
  RATE_LIMIT_WINDOW_MS,
} from "../lifecycle";
import { healthySnapshot } from "$lib/server/alerts/__tests__/helpers";

describe("isRateLimited", () => {
  const now = 1_700_000_000_000;
  it("never blocks first request", () => {
    expect(isRateLimited(null, now)).toBe(false);
  });
  it("blocks within the window", () => {
    expect(isRateLimited(now - 10_000, now)).toBe(true);
  });
  it("allows after the window", () => {
    expect(isRateLimited(now - RATE_LIMIT_WINDOW_MS - 1, now)).toBe(false);
  });
});

describe("isPlausibleApiKey", () => {
  it("accepts well-formed col_ keys", () => {
    expect(isPlausibleApiKey("col_" + "x".repeat(40))).toBe(true);
  });
  it("rejects keys without col_ prefix", () => {
    expect(isPlausibleApiKey("api_xxxxxxxxxxxxxxxxxxxx")).toBe(false);
  });
  it("rejects too-short keys", () => {
    expect(isPlausibleApiKey("col_short")).toBe(false);
  });
});

describe("parseOsString", () => {
  it("parses Ubuntu LTS", () => {
    expect(parseOsString("Ubuntu 24.04.4 LTS")).toEqual({ osType: "ubuntu", osVersion: "24.04.4" });
  });
  it("parses Debian", () => {
    expect(parseOsString("Debian 12")).toEqual({ osType: "debian", osVersion: "12" });
  });
  it("returns empty for missing input", () => {
    expect(parseOsString(undefined)).toEqual({ osType: "", osVersion: "" });
  });
});

describe("snapshotToClickhouseRow", () => {
  it("preserves server_id, timestamp, primitives, and JSON-encodes nested fields", () => {
    const snap = { ...healthySnapshot(), collector_version: "0.6.1" };
    const row = snapshotToClickhouseRow("srv-123", snap, 1_700_000_000_000);
    expect(row.server_id).toBe("srv-123");
    expect(row.timestamp).toBe(1_700_000_000_000);
    expect(row.collector_version).toBe("0.6.1");
    expect(row.hostname).toBe(snap.system.hostname);
    expect(row.cpu_idle_percent).toBe(snap.cpu.idle_percent);
    // JSON-encoded fields
    expect(typeof row.disks).toBe("string");
    const disks = JSON.parse(row.disks as string);
    expect(disks).toEqual(snap.disks);
    expect(typeof row.zfs).toBe("string");
  });

  it("persists memory_topology as JSON when present, empty string when absent", () => {
    const withTopo = {
      ...healthySnapshot(),
      memory_topology: {
        source: "dmidecode",
        total_slots: 24,
        populated_slots: 8,
        available_channels: 12,
        populated_channels: 8,
        downclocked: false,
        mixed_parts: false,
        dimms: [],
      },
    } as Parameters<typeof snapshotToClickhouseRow>[1];
    const row = snapshotToClickhouseRow("srv-1", withTopo, 1);
    expect(JSON.parse(row.memory_topology as string)).toMatchObject({ available_channels: 12, populated_channels: 8 });
    // Absent (pre-0.13.19 agent): '' matches the column default so the UI can
    // treat both identically as "no topology".
    const without = snapshotToClickhouseRow("srv-1", healthySnapshot(), 1);
    expect(without.memory_topology).toBe("");
  });

  it("falls back to defaults when fields are missing", () => {
    const empty = { system: {}, cpu: {}, memory: {}, os_alerts: {} } as unknown as Parameters<typeof snapshotToClickhouseRow>[1];
    const row = snapshotToClickhouseRow("srv-1", empty, 1);
    expect(row.collector_version).toBe("0.1.0");
    expect(row.hostname).toBe("");
    expect(row.cpu_idle_percent).toBe(0);
    expect(row.disks).toBe("[]");
  });

  // Regression: 2026-05-20. The C19 GPU collector shipped in Crucible
  // v0.13.0 but lifecycle.ts wasn't updated to persist snap.gpu — the
  // dashboard's GpuPanel had no data to render even on hosts with
  // nvidia-smi working. ClickHouse migration 002 added the column;
  // this test asserts the writer fills it.
  it("JSON-encodes snap.gpu when present (Crucible v0.13.0+ C19)", () => {
    const snap = {
      ...healthySnapshot(),
      gpu: {
        available: true,
        capabilities: { nvidia_smi: true, nvidia_driver_version: "550.163.01" },
        tier1: { available: true, driver_version: "550.163.01", gpus: [{ index: 0, name: "NVIDIA L4" }], xid_events: [] },
        tier2: { available: false, reason: "DCGM not active" },
        tier3: { available: false, reason: "stub" },
      },
    } as unknown as Parameters<typeof snapshotToClickhouseRow>[1];
    const row = snapshotToClickhouseRow("srv-gpu", snap, 1);
    expect(typeof row.gpu).toBe("string");
    const parsed = JSON.parse(row.gpu as string);
    expect(parsed.tier1.available).toBe(true);
    expect(parsed.tier1.gpus[0].name).toBe("NVIDIA L4");
  });

  it("uses empty-object sentinel for snap.gpu when absent (pre-0.13.0 agent)", () => {
    const empty = { system: {}, cpu: {}, memory: {}, os_alerts: {} } as unknown as Parameters<typeof snapshotToClickhouseRow>[1];
    const row = snapshotToClickhouseRow("srv-1", empty, 1);
    expect(row.gpu).toBe("{}");
  });
});
