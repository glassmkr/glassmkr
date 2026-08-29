import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static guard against regressing the Phase 4 hierarchical-scope
// enforcement. Sibling to pro-tier-gating-static.test.ts.
//
// Each acct-key-callable endpoint listed below must contain a
// reference to `requireScopeLevel` so a `read` key cannot drive a
// `write` endpoint and a `write` key cannot drive an `admin`
// endpoint. The actual scope level enforced is in the source; this
// lint only asserts the call site exists.
//
// Session-only endpoints (POST /account/keys, DELETE /account/keys/:id,
// POST /account/keys/:id/rotate) don't need scope checks here because
// acct_keys never reach them (rejected at the requireAuth allow-list).
// They're listed in EXEMPT_PATHS for the record.

const API_ROOT = join(__dirname, "..", "..", "..", "routes", "api", "v1");

interface GatedEndpoint {
  path: string;
  expected_level: "read" | "write" | "admin";
  reason: string;
}

const SCOPE_GATED_ENDPOINTS: GatedEndpoint[] = [
  {
    path: "servers/+server.ts",
    expected_level: "read", // GET; POST also gates `write` in the same file
    reason: "GET = read, POST = write — both checked in the same module",
  },
  {
    path: "servers/[id]/+server.ts",
    expected_level: "read", // GET; PATCH/DELETE gate write
    reason: "GET = read, PATCH/DELETE = write — three checks in the same module",
  },
  {
    path: "servers/[id]/rotate-key/+server.ts",
    expected_level: "write",
    reason: "Collector-key rotation modifies server state — write",
  },
  {
    path: "servers/[id]/restore/+server.ts",
    expected_level: "write",
    reason: "Single-server restore changes server state — write",
  },
  {
    path: "servers/restore-all/+server.ts",
    expected_level: "write",
    reason: "Bulk restore changes server state — write",
  },
  {
    path: "account/keys/+server.ts",
    expected_level: "read",
    reason: "GET = read (POST is session-only, doesn't need a check)",
  },
  {
    path: "account/audit/+server.ts",
    expected_level: "admin",
    reason: "Audit log read is admin-only (entries may echo request bodies)",
  },
];

const EXEMPT_PATHS = new Map<string, string>([
  ["ingest/+server.ts", "Collector key path; doesn't use the hierarchical scope model"],
  ["account/keys/[id]/+server.ts", "DELETE is session-only; acct_keys never reach the handler"],
  ["account/keys/[id]/rotate/+server.ts", "POST is session-only; acct_keys never reach the handler"],
  ["billing/status/+server.ts", "Session-only; no scope model needed"],
  ["version/+server.ts", "Public endpoint, no auth"],
  ["health/[serverId]/health/+server.ts", "Per-server health, ownership-gated; all plans see their own (no v1 read-only key need yet)"],
  ["health/[serverId]/alerts/+server.ts", "Per-server alerts, ownership-gated"],
  ["health/[serverId]/history/+server.ts", "Per-server metrics, ownership-gated"],
]);

describe("Hierarchical-scope enforcement static lint", () => {
  for (const ep of SCOPE_GATED_ENDPOINTS) {
    it(`${ep.path} references requireScopeLevel (${ep.expected_level} — ${ep.reason})`, () => {
      const fullPath = join(API_ROOT, ep.path);
      const source = readFileSync(fullPath, "utf8");
      expect(source).toContain("requireScopeLevel");
      // Spot-check that the expected level is mentioned somewhere in
      // the file. False positives possible (comments) but cheap defence.
      expect(source).toMatch(new RegExp(`["']${ep.expected_level}["']`));
    });
  }

  it("plan.ts exports requireScopeLevel", () => {
    const planFile = join(API_ROOT, "..", "..", "..", "lib", "server", "auth", "plan.ts");
    const source = readFileSync(planFile, "utf8");
    expect(source).toContain("export function requireScopeLevel");
  });

  it("documented exemptions exist and are explained", () => {
    expect(EXEMPT_PATHS.size).toBeGreaterThan(0);
    for (const [_path, reason] of EXEMPT_PATHS) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
