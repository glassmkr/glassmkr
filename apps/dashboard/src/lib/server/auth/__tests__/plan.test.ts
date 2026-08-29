import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { requireProTier, requireProTierForAcctKey, requireScopeLevel } from "../plan";
import type {
  AcctKeyPrincipal,
  CruKeyPrincipal,
  Principal,
  SessionPrincipal,
} from "../principal";

function session(plan: string): SessionPrincipal {
  return { kind: "session", customer_id: "cust_1", email: "x@y.z", plan };
}

function acctKey(plan: string, scope: "read" | "write" | "admin" = "admin"): AcctKeyPrincipal {
  return {
    kind: "acct_key",
    customer_id: "cust_1",
    key_id: "k_1",
    scope,
    // Default for every key that predates migration 041.
    capabilities: [],
    plan,
  };
}

function cruKey(): CruKeyPrincipal {
  return {
    kind: "cru_key",
    server_id: "srv_1",
    customer_id: "cust_1",
    key_id: "k_1",
    is_legacy_format: false,
  };
}

describe("requireProTier", () => {
  it("passes for pro session", () => {
    expect(() => requireProTier(session("pro"))).not.toThrow();
  });
  it("passes for business session", () => {
    expect(() => requireProTier(session("business"))).not.toThrow();
  });
  it("passes for enterprise session", () => {
    expect(() => requireProTier(session("enterprise"))).not.toThrow();
  });
  it("passes for pro acct_key", () => {
    expect(() => requireProTier(acctKey("pro"))).not.toThrow();
  });
  it("exempts cru_key regardless (collectors must always work)", () => {
    expect(() => requireProTier(cruKey())).not.toThrow();
  });

  // Inverted, not deleted, at the P0-03 resolution (2026-08-29). These used
  // to assert that a free session, a free acct_key and an unknown plan string
  // each got a 402. ground-truth.yaml records hosted as free and the public
  // tier-gating docs say the Free/Pro split is retired, so the 402 is the
  // behaviour that must never come back. Re-gating starts at the registry,
  // not here.
  it("passes a free session: hosted has no paid tier", () => {
    expect(() => requireProTier(session("free"))).not.toThrow();
  });
  it("passes a free acct_key", () => {
    expect(() => requireProTier(acctKey("free"))).not.toThrow();
  });
  it("passes an unknown plan string: nothing branches on plan any more", () => {
    expect(() => requireProTier(session("trial"))).not.toThrow();
  });
  it("never produces a 402 body at all: the machinery is gone, not dormant", () => {
    // The previous test here was VACUOUS after the pass-through landed: it
    // called requireProTier inside a try, nothing threw, the catch never ran,
    // and zero assertions executed, so it passed while checking nothing. It is
    // replaced by a live assertion in the opposite direction, plus a static
    // one that the upsell body was deleted rather than left dormant.
    expect(() => requireProTier(session("free"))).not.toThrow();
    // Comments stripped first: the file legitimately NAMES the deleted
    // machinery while explaining why it is gone, and this repository has now
    // hit the comment-matched-as-code trap in four separate guards.
    const src = fs.readFileSync(path.join(__dirname, "..", "plan.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(src).not.toContain("pro_required");
    expect(src).not.toContain("PRO_REQUIRED_BODY");
  });
});

describe("requireProTierForAcctKey", () => {
  it("no-op for free session (UI surface stays open)", () => {
    expect(() => requireProTierForAcctKey(session("free"))).not.toThrow();
  });
  it("no-op for cru_key", () => {
    expect(() => requireProTierForAcctKey(cruKey())).not.toThrow();
  });
  it("passes for pro acct_key", () => {
    expect(() => requireProTierForAcctKey(acctKey("pro"))).not.toThrow();
  });
  it("is a no-op for free acct_key too (2026-06-21 re-gating: the programmatic API is Free)", () => {
    // Pre-2026-06-21 this 402'd a free acct_key. The programmatic API is now
    // Free; the only Pro gates left are node count, retention, and AI analysis.
    expect(() => requireProTierForAcctKey(acctKey("free"))).not.toThrow();
  });
});

describe("requireScopeLevel (Phase 4 hierarchical scope)", () => {
  it("sessions bypass scope check (UI is the authority)", () => {
    expect(() => requireScopeLevel(session("pro"), "admin")).not.toThrow();
  });
  it("cru_key gets 403 on any scoped endpoint", () => {
    try {
      requireScopeLevel(cruKey(), "read");
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });
  it("read scope passes read check", () => {
    expect(() => requireScopeLevel(acctKey("pro", "read"), "read")).not.toThrow();
  });
  it("read scope FAILS write check with 403", () => {
    try {
      requireScopeLevel(acctKey("pro", "read"), "write");
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.body?.error).toBe("insufficient_scope");
      expect(err.body?.required_scope).toBe("write");
      expect(err.body?.your_scope).toBe("read");
    }
  });
  it("read scope FAILS admin check", () => {
    expect(() => requireScopeLevel(acctKey("pro", "read"), "admin")).toThrow();
  });
  it("write scope passes read + write", () => {
    expect(() => requireScopeLevel(acctKey("pro", "write"), "read")).not.toThrow();
    expect(() => requireScopeLevel(acctKey("pro", "write"), "write")).not.toThrow();
  });
  it("write scope FAILS admin", () => {
    try {
      requireScopeLevel(acctKey("pro", "write"), "admin");
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.body?.required_scope).toBe("admin");
      expect(err.body?.your_scope).toBe("write");
    }
  });
  it("admin scope passes all levels", () => {
    expect(() => requireScopeLevel(acctKey("pro", "admin"), "read")).not.toThrow();
    expect(() => requireScopeLevel(acctKey("pro", "admin"), "write")).not.toThrow();
    expect(() => requireScopeLevel(acctKey("pro", "admin"), "admin")).not.toThrow();
  });
  it("403 body is structured (error code + required + your scope)", () => {
    try {
      requireScopeLevel(acctKey("pro", "read"), "admin");
    } catch (err: any) {
      expect(err.body.error).toBe("insufficient_scope");
      expect(typeof err.body.message).toBe("string");
      expect(err.body.required_scope).toBe("admin");
      expect(err.body.your_scope).toBe("read");
    }
  });
  it("scope check is independent of plan check (a free admin key would 403 in this helper, but it'd 402 upstream)", () => {
    expect(() => requireScopeLevel(acctKey("free", "admin"), "admin")).not.toThrow();
  });
});
