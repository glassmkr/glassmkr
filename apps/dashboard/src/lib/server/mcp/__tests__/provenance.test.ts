import { describe, expect, it } from "vitest";
import {
  UNTRUSTED_SERVER_FIELDS,
  untrustedListPointers,
  untrustedServerPointers,
} from "../server.js";

// Codex 2026-07-21 P1-1: collector_version is stored verbatim from collector JSON
// at ingest (unvalidated) and is returned by list_servers + servers.get, so it
// must be flagged untrusted alongside hostname/ip/os/dmi. list and single-server
// pointers share one field list so the two can never drift.
describe("MCP server untrusted provenance", () => {
  it("marks collector_version untrusted in the single-server pointers", () => {
    expect(untrustedServerPointers()).toContain("/data/server/collector_version");
  });

  it("marks collector_version untrusted for every server in the list pointers", () => {
    const pointers = untrustedListPointers(2);
    expect(pointers).toContain("/data/servers/0/collector_version");
    expect(pointers).toContain("/data/servers/1/collector_version");
  });

  it("keeps the list and single-server field sets identical", () => {
    const listFields = untrustedListPointers(1).map((p) => p.replace("/data/servers/0/", ""));
    const detailFields = untrustedServerPointers().map((p) => p.replace("/data/server/", ""));
    expect(listFields).toEqual([...UNTRUSTED_SERVER_FIELDS]);
    expect(detailFields).toEqual([...UNTRUSTED_SERVER_FIELDS]);
  });
});
