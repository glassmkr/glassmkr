// Static wiring guard for manual resolve. The manual_resolve contract from
// CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md now lives in the shared service
// (alert-actions.ts), which both this route and the MCP resolve tool call, so
// the guard is split: the LOGIC assertions target the service, and the route is
// checked to actually delegate to it. Behaviour is exercised in
// services/__tests__/alert-actions.test.ts. If any of this regresses, a refactor
// could silently break the auditability convention (operator-closed forensic
// alerts must stay distinguishable from auto-decay closures) with no other test
// failing.
//
//  - rule.manual_resolve gates writes (non-forensic firing alert -> 400).
//  - the `manual-after-investigation; ` prefix is applied server-side.
//  - the already-resolved branch is idempotent (no UPDATE re-issued).
//  - the note has a 200-char cap.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "+server.ts"), "utf8");
const SVC = readFileSync(
  join(process.cwd(), "src/lib/server/services/alert-actions.ts"),
  "utf8",
);

describe("/api/v1/alerts/[id]/resolve wiring", () => {
  it("delegates the resolve contract to the shared alert-actions service", () => {
    expect(SRC).toContain("resolveAlertForCustomer");
  });

  it("enforces the manual_resolve gate via rule metadata (in the service)", () => {
    expect(SVC).toContain("getRuleMetadata");
    expect(SVC).toMatch(/rule\.manual_resolve\s*!==\s*true/);
  });

  it("applies the manual-after-investigation prefix server-side (in the service)", () => {
    expect(SVC).toContain('"manual-after-investigation; "');
  });

  it("caps resolution_reason at 200 chars (service constant, enforced by the route)", () => {
    expect(SVC).toContain("RESOLVE_NOTE_MAX_LEN = 200");
    expect(SRC).toContain("RESOLVE_NOTE_MAX_LEN");
  });

  it("returns idempotently when alert is already resolved (short-circuits before UPDATE)", () => {
    // Scope to the resolve function's UPDATE: acknowledgeAlertForCustomer, earlier
    // in the file, also contains "UPDATE active_alerts", so use lastIndexOf to
    // target the resolve path's UPDATE, which must follow its resolved_at guard.
    const guardIdx = SVC.indexOf("resolved_at !== null");
    const resolveUpdateIdx = SVC.lastIndexOf("UPDATE active_alerts");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(resolveUpdateIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(resolveUpdateIdx);
  });

  it("rejects non-forensic firing alerts with 400 (not a silent allow)", () => {
    expect(SRC).toMatch(/status:\s*400/);
    expect(SRC).toContain("use acknowledge");
  });
});
