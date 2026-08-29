import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Glassmkr used to have two operations called "delete" that did different
// things, reachable with the same account key:
//
//   MCP  glassmkr.admin.delete_server  -> soft, restorable
//   REST DELETE /servers/{id}?confirm  -> DELETE FROM servers, permanent
//
// An agent-readiness audit called this the highest-risk contradiction in the
// product. Since 2026-08-28 every interface soft-deletes, and permanent removal
// is a separate route with its own name and its own opt-in capability.
//
// These tests pin the split. They are static reads of the source because the
// alternative is a live database, and the properties worth protecting are
// structural: which SQL statement each path runs, and what guards the
// destructive one.
const ROOT = path.join(__dirname, "..", "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const softRoute = () => read("src/routes/api/v1/servers/[id]/+server.ts");
const purgeRoute = () => read("src/routes/api/v1/trashed-servers/[id]/+server.ts");

/**
 * Source with `//` comment lines removed.
 *
 * Needed because the soft-delete route explains, in a comment, that it used to
 * be `DELETE FROM servers`. That history is worth keeping, and a test asserting
 * the absence of a destructive statement must not be satisfied or defeated by
 * prose. Assert against the code.
 */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

describe("every interface soft-deletes", () => {
  it("REST DELETE /servers/{id} updates status, it does not destroy the row", () => {
    const s = softRoute();
    expect(s).toMatch(/UPDATE servers SET status = 'deleted'/);
    expect(codeOnly(s)).not.toMatch(/DELETE FROM servers/);
  });

  it("REST DELETE only affects an active server, so a repeat is not a fresh success", () => {
    expect(softRoute()).toMatch(/AND status = 'active'/);
  });

  it("the MCP path still uses the shared soft-delete service", () => {
    // It reaches it through confirmed-actions.ts, which runs the version check,
    // the token spend and this write in ONE transaction. The property that
    // matters is unchanged and is asserted here: MCP deletes by moving the
    // server to 'deleted' via the shared service, never by its own SQL and
    // never by destroying the row.
    expect(read("src/lib/server/mcp/server.ts")).toMatch(/confirmedSoftDelete\(/);
    expect(read("src/lib/server/mcp/confirmed-actions.ts")).toMatch(/softDeleteServerTx\(/);
    expect(read("src/lib/server/services/server-admin-actions.ts")).toMatch(
      /UPDATE servers SET status = 'deleted'/,
    );
    // And the MCP layer must not have grown a delete of its own.
    expect(read("src/lib/server/mcp/server.ts")).not.toMatch(/DELETE\s+FROM\s+servers/i);
  });

  it("the soft delete tells the caller it is reversible", () => {
    const s = softRoute();
    expect(s).toMatch(/permanent: false/);
    expect(s).toMatch(/restorable: true/);
  });
});

describe("permanent purge is a separate, guarded operation", () => {
  it("lives at its own route and is the only hard delete", () => {
    expect(purgeRoute()).toMatch(/DELETE FROM servers/);
  });

  it("refuses a server that is not already in the trash", () => {
    // The condition that makes the trash a real waiting room rather than a
    // formality: you cannot destroy a live server in one call.
    expect(purgeRoute()).toMatch(/AND status = 'deleted'/);
    expect(purgeRoute()).toMatch(/not_trashed/);
  });

  it("requires the opt-in capability, not merely admin scope", () => {
    const s = purgeRoute();
    expect(s).toMatch(/principalHasCapability\(principal, "servers:purge"\)/);
    expect(s).toMatch(/missing_capability/);
  });

  it("requires recent re-authentication, so a leaked key alone is not enough", () => {
    expect(purgeRoute()).toMatch(/requireRecentReAuth\(/);
  });

  it("requires explicit confirmation", () => {
    expect(purgeRoute()).toMatch(/confirm.*!== "true"|confirm_required/s);
  });

  it("is absent from MCP entirely", () => {
    // An agent has no path to permanent destruction at all. If a purge tool is
    // ever added to the MCP surface, this fails and forces that to be a
    // deliberate, reviewed decision.
    const mcp = read("src/lib/server/mcp/server.ts");
    expect(mcp).not.toMatch(/trashed-servers/);
    expect(mcp).not.toMatch(/servers:purge/);
    expect(mcp).not.toMatch(/purge/i);
  });
});

describe("the documentation matches the behaviour", () => {
  it("the OpenAPI soft delete no longer claims to be permanent", () => {
    const spec = JSON.parse(read("static/api/openapi.json"));
    const op = spec.paths["/servers/{id}"].delete;
    expect(op.description ?? "").not.toMatch(/PERMANENT/);
  });

  it("the purge route is documented", () => {
    const spec = JSON.parse(read("static/api/openapi.json"));
    expect(spec.paths["/trashed-servers/{id}"]?.delete).toBeTruthy();
  });
});
