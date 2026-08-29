import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static guard for the fleet auto-onboard path (migration 033). The
// re-enroll branch in POST /api/v1/servers is a security- and
// billing-sensitive surface (it rotates a collector key and must not
// bypass suspension or the node quota), so pin its invariants at the
// source level the same way scope-enforcement-static / bola-static do.
// A DB-backed behavioural test needs the PG integration harness; this
// lint catches an accidental regression of the shape without one.

const HANDLER = join(
  __dirname, "..", "..", "..", "routes", "api", "v1", "servers", "+server.ts",
);

const src = readFileSync(HANDLER, "utf8");

describe("POST /api/v1/servers machine_id onboarding", () => {
  it("accepts machine_id in the request-body allowlist", () => {
    expect(src).toMatch(/pickAllowedFields\(rawBody,\s*\[[^\]]*"machine_id"[^\]]*\]/);
  });

  it("validates machine_id against a bounded charset", () => {
    expect(src).toContain("MACHINE_ID_REGEX");
    expect(src).toContain("validateMachineId");
  });

  it("looks up an existing server by (customer_id, machine_id) before creating", () => {
    expect(src).toMatch(/WHERE customer_id = \$1 AND machine_id = \$2/);
  });

  it("refuses to re-enroll onto a suspended server (402, no key rotation)", () => {
    // The suspended branch must return before the key-rotation transaction.
    const suspendedIdx = src.indexOf('row.status === "suspended"');
    const rotateIdx = src.indexOf("UPDATE account_api_keys SET revoked_at = NOW() WHERE server_id");
    expect(suspendedIdx).toBeGreaterThan(-1);
    expect(rotateIdx).toBeGreaterThan(-1);
    expect(suspendedIdx).toBeLessThan(rotateIdx);
    expect(src).toContain("server_suspended");
  });

  it("re-enroll rotates the collector key (revoke old, insert new) without a new row", () => {
    expect(src).toContain("reenrolled: true");
    // No generateId("srv_"...) on the re-enroll path -> the only server-id
    // mint is the create path. Re-enroll reuses row.id.
    expect(src).toMatch(/reenroll[\s\S]*server_id = \$1 AND revoked_at IS NULL/);
  });

  it("stores machine_id on the create-path INSERT", () => {
    expect(src).toMatch(/INSERT INTO servers \(id, customer_id, name, hostname, api_key_hash, tags, profile, machine_id\)/);
  });

  it("maps a unique-index race to a 409 conflict (retryable), not a 500", () => {
    expect(src).toContain('err?.code === "23505"');
    expect(src).toMatch(/status:\s*409/);
  });

  it("still enforces the node quota on the create path", () => {
    expect(src).toContain("plan_server_limit");
    expect(src).toContain("quota_exceeded");
  });
});
