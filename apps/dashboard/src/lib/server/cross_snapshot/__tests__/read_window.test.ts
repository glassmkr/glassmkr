// readWindow tests. Mocks the clickhouse client to assert query shape +
// caching behavior; does NOT execute real SQL.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@glassmkr/db/clickhouse", () => ({
  clickhouse: {
    query: vi.fn(),
  },
}));

import { clickhouse } from "@glassmkr/db/clickhouse";

import { _clearCacheForTests } from "../cache.js";
import { readWindow } from "../read_window.js";

const mockQuery = clickhouse.query as unknown as ReturnType<typeof vi.fn>;

function mockRows(rows: Array<Record<string, unknown>>) {
  mockQuery.mockResolvedValueOnce({
    json: async () => rows,
  } as never);
}

beforeEach(() => {
  mockQuery.mockReset();
  _clearCacheForTests();
});
afterEach(() => {
  _clearCacheForTests();
});

describe("readWindow time-window mode", () => {
  it("issues a SELECT with the requested columns and time bounds", async () => {
    mockRows([
      { timestamp: "2026-05-19T12:00:00Z", smart: "[]" },
      { timestamp: "2026-05-19T12:05:00Z", smart: "[]" },
    ]);

    const rows = await readWindow(
      "host-1",
      { fromSecondsAgo: 3600 },
      { columns: ["timestamp", "smart"] },
    );

    expect(rows.length).toBe(2);
    expect(typeof rows[0]!.timestamp).toBe("number");
    expect(rows[0]!.smart).toBe("[]");

    const call = mockQuery.mock.calls[0]![0] as {
      query: string;
      query_params: Record<string, unknown>;
    };
    expect(call.query).toMatch(/SELECT timestamp, smart/);
    expect(call.query).toMatch(/INTERVAL \{fromSec:UInt32\} SECOND/);
    expect(call.query_params).toMatchObject({
      serverId: "host-1",
      fromSec: 3600,
      toSec: 0,
    });
  });

  it("forces timestamp into the projection when caller omits it", async () => {
    mockRows([{ timestamp: "2026-05-19T12:00:00Z", smart: "[]" }]);
    await readWindow("host-1", { fromSecondsAgo: 60 }, { columns: ["smart"] });
    const call = mockQuery.mock.calls[0]![0] as { query: string };
    expect(call.query).toMatch(/SELECT timestamp, smart/);
  });
});

describe("readWindow count mode", () => {
  it("uses ORDER BY DESC LIMIT and re-sorts ascending", async () => {
    // ClickHouse returns rows in DESC order; readWindow reverses to ASC.
    mockRows([
      { timestamp: "2026-05-19T12:10:00Z", smart: "[]" },
      { timestamp: "2026-05-19T12:05:00Z", smart: "[]" },
      { timestamp: "2026-05-19T12:00:00Z", smart: "[]" },
    ]);

    const rows = await readWindow(
      "host-1",
      { count: 3 },
      { columns: ["timestamp", "smart"] },
    );

    expect(rows.length).toBe(3);
    expect(rows[0]!.timestamp).toBeLessThan(rows[2]!.timestamp as number);

    const call = mockQuery.mock.calls[0]![0] as {
      query: string;
      query_params: Record<string, unknown>;
    };
    expect(call.query).toMatch(/ORDER BY timestamp DESC/);
    expect(call.query).toMatch(/LIMIT \{limit:UInt32\}/);
    expect(call.query_params).toMatchObject({ serverId: "host-1", limit: 3 });
  });
});

describe("readWindow caching", () => {
  it("returns cached value on identical second call (no extra query)", async () => {
    mockRows([{ timestamp: "2026-05-19T12:00:00Z", smart: "[]" }]);

    await readWindow(
      "host-1",
      { fromSecondsAgo: 60 },
      { columns: ["timestamp", "smart"] },
    );
    await readWindow(
      "host-1",
      { fromSecondsAgo: 60 },
      { columns: ["timestamp", "smart"] },
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("different parsed flag = different cache key (separate query)", async () => {
    mockRows([{ timestamp: "2026-05-19T12:00:00Z", smart: "[]" }]);
    mockRows([{ timestamp: "2026-05-19T12:00:00Z", smart: "[]" }]);

    await readWindow(
      "host-1",
      { fromSecondsAgo: 60 },
      { columns: ["timestamp", "smart"], parsed: false },
    );
    await readWindow(
      "host-1",
      { fromSecondsAgo: 60 },
      { columns: ["timestamp", "smart"], parsed: true },
    );
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("readWindow parsed: true", () => {
  it("safeParses JSON columns and tolerates malformed payloads", async () => {
    mockRows([
      { timestamp: "2026-05-19T12:00:00Z", smart: '[{"device":"sda"}]' },
      { timestamp: "2026-05-19T12:05:00Z", smart: "not-json" },
    ]);

    const rows = await readWindow(
      "host-1",
      { fromSecondsAgo: 60 },
      { columns: ["timestamp", "smart"], parsed: true },
    );

    expect(rows[0]!.smart).toEqual([{ device: "sda" }]);
    // Malformed payload falls back to null per safeParse default fallback.
    expect(rows[1]!.smart).toBeNull();
  });

  it("normalises timestamps to unix ms in both modes", async () => {
    mockRows([{ timestamp: "2026-05-19T12:00:00Z", smart: "[]" }]);
    const rows = await readWindow(
      "host-1",
      { fromSecondsAgo: 60 },
      { columns: ["timestamp", "smart"] },
    );
    expect(rows[0]!.timestamp).toBe(new Date("2026-05-19T12:00:00Z").getTime());
  });
});
