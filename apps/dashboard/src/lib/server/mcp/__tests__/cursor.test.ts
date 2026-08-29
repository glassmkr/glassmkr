import { beforeEach, describe, expect, it } from "vitest";
import { decodeFleetCursor, encodeFleetCursor } from "../cursor.js";

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
});

describe("MCP fleet cursor", () => {
  it("round trips for the account that created it", () => {
    const date = new Date("2026-07-18T12:34:56.789Z");
    const cursor = encodeFleetCursor("customer-a", { createdAt: date, serverId: "srv_1" });
    expect(decodeFleetCursor("customer-a", cursor)).toEqual({
      createdAt: date,
      serverId: "srv_1",
    });
  });

  it("cannot cross account boundaries", () => {
    const cursor = encodeFleetCursor("customer-a", {
      createdAt: new Date("2026-07-18T12:34:56.789Z"),
      serverId: "srv_1",
    });
    expect(() => decodeFleetCursor("customer-b", cursor)).toThrow("cursor is invalid");
  });

  it("rejects a modified signature", () => {
    const cursor = encodeFleetCursor("customer-a", {
      createdAt: new Date("2026-07-18T12:34:56.789Z"),
      serverId: "srv_1",
    });
    const modified = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    expect(() => decodeFleetCursor("customer-a", modified)).toThrow("cursor is invalid");
  });
});
