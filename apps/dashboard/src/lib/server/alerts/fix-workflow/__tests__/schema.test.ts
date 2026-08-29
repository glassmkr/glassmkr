// Phase 1 schema validation tests for the FIX workflow data model.
// Loader-level tests (parse + Zod-validate every YAML in ../rules/)
// run automatically because importing the loader triggers loadRules().
// Anything malformed throws synchronously at module load → vitest
// reports the failure with the offending filename.
//
// In addition we exercise:
//   - selectVariant() picks the most-specific match
//   - Zod schema rejects obviously-malformed payloads
//   - The raid_degraded sample (Phase 1 reference rule) parses

import { describe, it, expect } from "vitest";
import {
  RuleMetadataSchema,
  selectVariant,
  evaluateCondition,
  type Variant,
} from "../schema.js";
import { ruleRegistry, getRuleMetadata, listMetadataRuleTypes } from "../loader.js";

describe("RuleMetadataSchema", () => {
  it("accepts the canonical raid_degraded sample", () => {
    // Loader has already validated every YAML; if this is in the
    // registry it parsed cleanly. Phase 1 ships exactly one rule
    // (raid_degraded). Phase 2 grows the registry to 37+.
    const r = getRuleMetadata("raid_degraded");
    expect(r).toBeDefined();
    expect(r!.priority).toBe("P1");
    expect(r!.fix.variants.length).toBeGreaterThanOrEqual(1);
    expect(r!.fix.provenance.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects an id with uppercase letters", () => {
    const result = RuleMetadataSchema.safeParse({
      id: "Raid_Degraded",
      priority: "P1",
      title: "x",
      summary: "x",
      fix: {
        quick_check: { command: "true", description: "x" },
        prerequisites: [],
        safe_mode: null,
        variants: [
          {
            distro_match: ["*"],
            vendor_match: ["*"],
            command: "true",
            description: "x",
          },
        ],
        validation: null,
        rollback: { available: false, command: null, note: "x" },
        impact: {
          blast_radius: "x",
          estimated_duration: "x",
          irreversible_steps: false,
        },
        provenance: {
          last_verified: "2026-05-16",
          tested_on: ["x"],
          tester: "x",
          source_note: "x",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects last_verified that is not ISO YYYY-MM-DD", () => {
    const result = RuleMetadataSchema.safeParse({
      id: "x",
      priority: "P1",
      title: "x",
      summary: "x",
      fix: {
        quick_check: { command: "true", description: "x" },
        prerequisites: [],
        safe_mode: null,
        variants: [
          {
            distro_match: ["*"],
            vendor_match: ["*"],
            command: "true",
            description: "x",
          },
        ],
        validation: null,
        rollback: { available: false, command: null, note: "x" },
        impact: {
          blast_radius: "x",
          estimated_duration: "x",
          irreversible_steps: false,
        },
        provenance: {
          last_verified: "April 9 2026",
          tested_on: ["x"],
          tester: "x",
          source_note: "x",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  // 2026-05-18 audit Phase 1 schema additions: research_basis enum,
  // subordinate_to, incident_group, P0 priority.
  function baseRule(): Record<string, unknown> {
    return {
      id: "test_rule",
      priority: "P2",
      title: "x",
      summary: "x",
      fix: {
        quick_check: { command: "true", description: "x" },
        prerequisites: [],
        safe_mode: null,
        variants: [
          {
            distro_match: ["*"],
            vendor_match: ["*"],
            command: "true",
            description: "x",
          },
        ],
        validation: null,
        rollback: { available: false, command: null, note: "x" },
        impact: { blast_radius: "x", estimated_duration: "x", irreversible_steps: false },
        provenance: { last_verified: "2026-05-18", tested_on: ["x"], tester: "x", source_note: "x" },
      },
    };
  }

  it("accepts P0 priority", () => {
    const r = baseRule();
    r.priority = "P0";
    expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
  });

  it("accepts each research_basis enum value on provenance", () => {
    const values = [
      "fleet-tested", "vendor-anchor", "heuristic-from-guide",
      "operator-pattern", "research-derived", "reference", "validation-pending",
    ];
    for (const v of values) {
      const r = baseRule();
      (r.fix as any).provenance.research_basis = v;
      expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects an unknown research_basis value", () => {
    const r = baseRule();
    (r.fix as any).provenance.research_basis = "made-up-source";
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });

  it("treats research_basis as optional (existing rules without it stay valid)", () => {
    const r = baseRule();
    // No research_basis at all.
    expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
  });

  it("accepts subordinate_to with a valid rule id", () => {
    const r = baseRule();
    (r as any).subordinate_to = "cpu_pressure_high";
    expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
  });

  it("accepts incident_group with valid shape", () => {
    const r = baseRule();
    (r as any).incident_group = {
      group_id: "accept_backlog_or_syn_flood",
      correlation_window_seconds: 300,
    };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
  });

  // 2026-05-19 subordination Phase 1: correlation_window_seconds bounds
  // tightened from "nonnegative" to "60..3600". Lower bound prevents
  // same-snapshot-tick races; upper bound prevents unrelated incidents
  // an hour apart from getting silently grouped.
  it("accepts correlation_window_seconds at lower bound (60)", () => {
    const r = baseRule();
    (r as any).incident_group = { group_id: "g", correlation_window_seconds: 60 };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
  });
  it("accepts correlation_window_seconds at upper bound (3600)", () => {
    const r = baseRule();
    (r as any).incident_group = { group_id: "g", correlation_window_seconds: 3600 };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(true);
  });
  it("rejects correlation_window_seconds below 60", () => {
    const r = baseRule();
    (r as any).incident_group = { group_id: "g", correlation_window_seconds: 30 };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });
  it("rejects correlation_window_seconds above 3600", () => {
    const r = baseRule();
    (r as any).incident_group = { group_id: "g", correlation_window_seconds: 7200 };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a rule that declares BOTH subordinate_to and incident_group", () => {
    const r = baseRule();
    (r as any).subordinate_to = "cpu_pressure_high";
    (r as any).incident_group = {
      group_id: "some_group",
      correlation_window_seconds: 300,
    };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });

  it("rejects subordinate_to with uppercase characters", () => {
    const r = baseRule();
    (r as any).subordinate_to = "CPU_pressure_high";
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });
});

// 2026-05-19 subordination Phase 1.2: detectSubordinationCycles guards
// boot against runtime infinite-loop hazards. Tested in isolation here
// (not via the actual loader Vite glob path).
describe("detectSubordinationCycles", () => {
  function mkReg(rules: Array<{ id: string; subordinate_to?: string }>) {
    const m = new Map<string, any>();
    for (const r of rules) {
      m.set(r.id, {
        id: r.id,
        priority: "P2",
        title: "x",
        summary: "x",
        fix: {} as any,
        ...(r.subordinate_to ? { subordinate_to: r.subordinate_to } : {}),
      });
    }
    return m as ReadonlyMap<string, any>;
  }

  it("accepts a flat registry with no subordinations", async () => {
    const { detectSubordinationCycles } = await import("../loader.js");
    const reg = mkReg([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(() => detectSubordinationCycles(reg)).not.toThrow();
  });

  it("accepts a linear chain a -> b -> c (c has no parent)", async () => {
    const { detectSubordinationCycles } = await import("../loader.js");
    const reg = mkReg([
      { id: "a", subordinate_to: "b" },
      { id: "b", subordinate_to: "c" },
      { id: "c" },
    ]);
    expect(() => detectSubordinationCycles(reg)).not.toThrow();
  });

  it("accepts forward references (parent not yet in registry)", async () => {
    // Many PR #157 declarations subordinate to rules that ship in
    // follow-up PRs (cpu_pressure_high, kernel_panic_detected, etc.).
    // This must not break boot.
    const { detectSubordinationCycles } = await import("../loader.js");
    const reg = mkReg([{ id: "a", subordinate_to: "future_rule" }]);
    expect(() => detectSubordinationCycles(reg)).not.toThrow();
  });

  it("rejects a direct self-cycle", async () => {
    const { detectSubordinationCycles } = await import("../loader.js");
    const reg = mkReg([{ id: "a", subordinate_to: "a" }]);
    expect(() => detectSubordinationCycles(reg)).toThrow(/cycle detected/);
  });

  it("rejects a two-rule cycle a -> b -> a", async () => {
    const { detectSubordinationCycles } = await import("../loader.js");
    const reg = mkReg([
      { id: "a", subordinate_to: "b" },
      { id: "b", subordinate_to: "a" },
    ]);
    expect(() => detectSubordinationCycles(reg)).toThrow(/cycle detected/);
  });

  it("rejects a three-rule cycle a -> b -> c -> a", async () => {
    const { detectSubordinationCycles } = await import("../loader.js");
    const reg = mkReg([
      { id: "a", subordinate_to: "b" },
      { id: "b", subordinate_to: "c" },
      { id: "c", subordinate_to: "a" },
    ]);
    expect(() => detectSubordinationCycles(reg)).toThrow(/cycle detected/);
  });
});

describe("selectVariant", () => {
  const variants: Variant[] = [
    {
      distro_match: ["*"],
      vendor_match: ["*"],
      command: "wildcard",
      description: "fallback",
    },
    {
      distro_match: ["debian-*", "ubuntu-*"],
      vendor_match: ["*"],
      command: "debian-family",
      description: "deb family",
    },
    {
      distro_match: ["debian-12"],
      vendor_match: ["supermicro"],
      command: "deb12-smc",
      description: "very specific",
    },
  ];

  it("picks the most specific variant (both distro + vendor matched)", () => {
    const v = selectVariant(variants, { distro: "debian-12", vendor: "supermicro" });
    expect(v?.command).toBe("deb12-smc");
  });

  it("falls back to the family glob when vendor doesn't match the specific variant", () => {
    const v = selectVariant(variants, { distro: "debian-12", vendor: "dell" });
    expect(v?.command).toBe("debian-family");
  });

  it("falls back to wildcard when nothing else matches", () => {
    const v = selectVariant(variants, { distro: "alpine-3.19", vendor: "hetzner" });
    expect(v?.command).toBe("wildcard");
  });

  it("returns null when there is no wildcard fallback and nothing matches", () => {
    const noFallback: Variant[] = [
      {
        distro_match: ["debian-*"],
        vendor_match: ["dell"],
        command: "x",
        description: "x",
      },
    ];
    const v = selectVariant(noFallback, { distro: "alpine-3.19", vendor: "hetzner" });
    expect(v).toBeNull();
  });

  // Regression: AlmaLinux's os_id is `almalinux`, so the precise token is
  // `almalinux-9.6`. The canonical RHEL-family pattern uses `almalinux-*`.
  // raid_degraded once used `alma-*`, which does NOT match `almalinux-9.6`
  // (the glob requires an `alma-` prefix), so AlmaLinux hosts silently fell
  // through to the wildcard fallback instead of the RHEL-family variant
  // (Phase 5 pick 6, 2026-05-29). This guards the corrected pattern.
  const rhelFamily: Variant[] = [
    { distro_match: ["*"], vendor_match: ["*"], command: "wildcard", description: "fallback" },
    {
      distro_match: ["rhel-*", "rocky-*", "almalinux-*", "centos-*", "fedora-*"],
      vendor_match: ["*"],
      command: "rhel-family",
      description: "rhel family",
    },
  ];

  it("matches almalinux-9.6 to the RHEL-family variant (not the wildcard fallback)", () => {
    const v = selectVariant(rhelFamily, { distro: "almalinux-9.6", vendor: "gigabyte" });
    expect(v?.command).toBe("rhel-family");
  });

  it("the legacy alma-* glob would NOT have matched almalinux-9.6 (documents the bug)", () => {
    const legacy: Variant[] = [
      { distro_match: ["*"], vendor_match: ["*"], command: "wildcard", description: "fallback" },
      { distro_match: ["rhel-*", "rocky-*", "alma-*", "centos-*"], vendor_match: ["*"], command: "rhel-legacy", description: "buggy" },
    ];
    const v = selectVariant(legacy, { distro: "almalinux-9.6", vendor: "gigabyte" });
    expect(v?.command).toBe("wildcard"); // fell through, the bug
  });

  it("rocky-9.6 and fedora-40 also match the RHEL-family variant", () => {
    expect(selectVariant(rhelFamily, { distro: "rocky-9.6", vendor: "supermicro" })?.command).toBe("rhel-family");
    expect(selectVariant(rhelFamily, { distro: "fedora-40", vendor: null })?.command).toBe("rhel-family");
  });

  // 2026-05-18 regression coverage: caught on the validation fleet
  // where Crucible 0.10.1 didn't ship VERSION_ID, so distro tokens
  // arrived as bare "debian" / "ubuntu" — and the YAML library only
  // persists bare vendor ("gigabyte"). Authors' intent for "x-*" was
  // always "any version/model of x"; the matcher now honors that.
  it("matches `x-*` against a bare `x` token (distro side)", () => {
    // Older agent has no os_version_id → buildDistroToken returns
    // "debian" not "debian-13". The debian-family variant must still
    // win over the wildcard fallback.
    const v = selectVariant(variants, { distro: "debian", vendor: "dell" });
    expect(v?.command).toBe("debian-family");
  });

  it("matches `x-*` against a bare `x` token (vendor side, case-insensitive)", () => {
    const vendorOnly: Variant[] = [
      {
        distro_match: ["*"],
        vendor_match: ["*"],
        command: "wildcard",
        description: "fallback",
      },
      {
        distro_match: ["debian-*", "ubuntu-*"],
        vendor_match: ["Gigabyte-*", "ASRock-*"],
        command: "deb-amd-mobo",
        description: "deb family on AMD-vendor mobos",
      },
    ];
    // Dashboard persists bare "gigabyte" canonical, not
    // "gigabyte-mc12le". The author meant "any Gigabyte board".
    const v = selectVariant(vendorOnly, { distro: "debian-13", vendor: "gigabyte" });
    expect(v?.command).toBe("deb-amd-mobo");
  });

  it("still requires a literal-stem match on the bare-token path", () => {
    // "debian-*" should NOT match "debiana" or "debx" — the bare-token
    // path only matches an exact stem.
    const debianOnly: Variant[] = [
      {
        distro_match: ["*"],
        vendor_match: ["*"],
        command: "wildcard",
        description: "fb",
      },
      {
        distro_match: ["debian-*"],
        vendor_match: ["*"],
        command: "deb",
        description: "deb",
      },
    ];
    expect(selectVariant(debianOnly, { distro: "debiana", vendor: null })?.command).toBe("wildcard");
    expect(selectVariant(debianOnly, { distro: "debian", vendor: null })?.command).toBe("deb");
  });
});

// =========================================================================
// condition_match (Q1-Q4 from CC_FIX_WORKFLOW_SCHEMA_CONDITION_MATCH_2026-05-17)
// =========================================================================

describe("condition_match — schema validation", () => {
  // `unknown`-typed payload so individual tests can mutate
  // condition_match shape freely without TypeScript narrowing the
  // op/value union to a literal type.
  function base(): unknown {
    return {
      id: "test_rule",
      priority: "P1",
      title: "t",
      summary: "s",
      fix: {
        quick_check: { command: "true", description: "x" },
        prerequisites: [],
        safe_mode: null,
        variants: [
          {
            distro_match: ["*"],
            vendor_match: ["*"],
            condition_match: { attribute: "x", op: "gte", value: 10 },
            command: "c",
            description: "d",
          },
          {
            distro_match: ["*"],
            vendor_match: ["*"],
            command: "fallback",
            description: "fallback",
          },
        ],
        validation: null,
        rollback: { available: false, command: null, note: "ok" },
        impact: { blast_radius: "x", estimated_duration: "x", irreversible_steps: false },
        provenance: {
          last_verified: "2026-05-17",
          tested_on: ["x"],
          tester: "x",
          source_note: "x",
        },
      },
    };
  }

  it("accepts well-formed condition_match with each of the 8 ops", () => {
    const ops = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin"] as const;
    for (const op of ops) {
      const r = base() as any;
      const value =
        op === "in" || op === "nin"
          ? [1, 2]
          : op === "eq" || op === "ne"
            ? "x"
            : 5;
      r.fix.variants[0].condition_match = { attribute: "x", op, value };
      const parsed = RuleMetadataSchema.safeParse(r);
      expect(parsed.success, `op ${op} should parse`).toBe(true);
    }
  });

  it("rejects unknown op", () => {
    const r = base() as any;
    r.fix.variants[0].condition_match = { attribute: "x", op: "matches", value: "y" };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });

  it("rejects empty attribute", () => {
    const r = base() as any;
    r.fix.variants[0].condition_match = { attribute: "", op: "eq", value: "x" };
    expect(RuleMetadataSchema.safeParse(r).success).toBe(false);
  });
});

describe("condition_match — variant selection", () => {
  const wearVariants: Variant[] = [
    {
      distro_match: ["*"],
      vendor_match: ["*"],
      condition_match: { attribute: "percentage_used", op: "gte", value: 95 },
      command: "imminent",
      description: "wear >= 95",
    },
    {
      distro_match: ["*"],
      vendor_match: ["*"],
      condition_match: { attribute: "percentage_used", op: "lt", value: 95 },
      command: "planned",
      description: "wear < 95",
    },
    {
      distro_match: ["*"],
      vendor_match: ["*"],
      command: "fallback",
      description: "missing-evidence fallback",
    },
  ];

  it("picks imminent variant when percentage_used >= 95", () => {
    const v = selectVariant(
      wearVariants,
      { distro: "ubuntu-24.04", vendor: "supermicro" },
      { percentage_used: 96 },
    );
    expect(v?.command).toBe("imminent");
  });

  it("picks planned variant when percentage_used < 95", () => {
    const v = selectVariant(
      wearVariants,
      { distro: "ubuntu-24.04", vendor: "supermicro" },
      { percentage_used: 50 },
    );
    expect(v?.command).toBe("planned");
  });

  it("falls back to non-conditioned variant when evidence is missing", () => {
    const v = selectVariant(
      wearVariants,
      { distro: "ubuntu-24.04", vendor: "supermicro" },
      {},
    );
    expect(v?.command).toBe("fallback");
  });

  it("falls back to non-conditioned variant when evidence is undefined", () => {
    const v = selectVariant(
      wearVariants,
      { distro: "ubuntu-24.04", vendor: "supermicro" },
      undefined,
    );
    expect(v?.command).toBe("fallback");
  });

  it("set-membership op (in) — picks FAULTED variant for zfs-style state band", () => {
    const stateVariants: Variant[] = [
      {
        distro_match: ["*"],
        vendor_match: ["*"],
        condition_match: { attribute: "state", op: "in", value: ["FAULTED", "UNAVAIL"] },
        command: "data-at-risk",
        description: "FAULTED or UNAVAIL",
      },
      {
        distro_match: ["*"],
        vendor_match: ["*"],
        condition_match: { attribute: "state", op: "eq", value: "DEGRADED" },
        command: "degraded",
        description: "DEGRADED",
      },
      {
        distro_match: ["*"],
        vendor_match: ["*"],
        command: "fallback",
        description: "fallback",
      },
    ];
    const v = selectVariant(stateVariants, { distro: "*", vendor: "*" }, { state: "FAULTED" });
    expect(v?.command).toBe("data-at-risk");
    const w = selectVariant(stateVariants, { distro: "*", vendor: "*" }, { state: "DEGRADED" });
    expect(w?.command).toBe("degraded");
  });

  it("boolean attribute (zfs scrub_never_run = true)", () => {
    const r = selectVariant(
      [
        {
          distro_match: ["*"],
          vendor_match: ["*"],
          condition_match: { attribute: "scrub_never_run", op: "eq", value: true },
          command: "scrub-it",
          description: "never scrubbed",
        },
        {
          distro_match: ["*"],
          vendor_match: ["*"],
          command: "fallback",
          description: "fallback",
        },
      ],
      { distro: "*", vendor: "*" },
      { scrub_never_run: true },
    );
    expect(r?.command).toBe("scrub-it");
  });

  it("conditioned variant beats non-conditioned variant on specificity when both match", () => {
    const v = selectVariant(
      [
        {
          distro_match: ["*"],
          vendor_match: ["*"],
          command: "non-conditioned",
          description: "matches everything",
        },
        {
          distro_match: ["*"],
          vendor_match: ["*"],
          condition_match: { attribute: "x", op: "gt", value: 0 },
          command: "conditioned",
          description: "matches when x > 0",
        },
      ],
      { distro: "*", vendor: "*" },
      { x: 5 },
    );
    expect(v?.command).toBe("conditioned");
  });

  it("type mismatch on numeric op against string evidence silently skips (Q4)", () => {
    const v = selectVariant(
      [
        {
          distro_match: ["*"],
          vendor_match: ["*"],
          condition_match: { attribute: "x", op: "gte", value: 10 },
          command: "should-not-match",
          description: "conditioned",
        },
        {
          distro_match: ["*"],
          vendor_match: ["*"],
          command: "fallback",
          description: "fallback",
        },
      ],
      { distro: "*", vendor: "*" },
      { x: "not-a-number" },
    );
    expect(v?.command).toBe("fallback");
  });
});

describe("evaluateCondition — direct semantics", () => {
  it("eq matches identical primitives", () => {
    expect(evaluateCondition({ attribute: "s", op: "eq", value: "x" }, { s: "x" })).toBe(true);
    expect(evaluateCondition({ attribute: "s", op: "eq", value: "x" }, { s: "y" })).toBe(false);
  });

  it("ne matches differing primitives", () => {
    expect(evaluateCondition({ attribute: "n", op: "ne", value: 5 }, { n: 6 })).toBe(true);
    expect(evaluateCondition({ attribute: "n", op: "ne", value: 5 }, { n: 5 })).toBe(false);
  });

  it("numeric ops require numeric operands", () => {
    expect(evaluateCondition({ attribute: "n", op: "gt", value: 10 }, { n: 11 })).toBe(true);
    expect(evaluateCondition({ attribute: "n", op: "gt", value: 10 }, { n: 10 })).toBe(false);
    expect(evaluateCondition({ attribute: "n", op: "gte", value: 10 }, { n: 10 })).toBe(true);
    expect(evaluateCondition({ attribute: "n", op: "lt", value: 10 }, { n: 9 })).toBe(true);
    expect(evaluateCondition({ attribute: "n", op: "lte", value: 10 }, { n: 10 })).toBe(true);
  });

  it("in / nin treat the value as a set", () => {
    expect(evaluateCondition({ attribute: "s", op: "in", value: ["a", "b"] }, { s: "a" })).toBe(true);
    expect(evaluateCondition({ attribute: "s", op: "in", value: ["a", "b"] }, { s: "c" })).toBe(false);
    expect(evaluateCondition({ attribute: "s", op: "nin", value: ["a", "b"] }, { s: "c" })).toBe(true);
    expect(evaluateCondition({ attribute: "s", op: "nin", value: ["a", "b"] }, { s: "a" })).toBe(false);
  });

  it("returns false when evidence is undefined or missing the attribute", () => {
    expect(evaluateCondition({ attribute: "x", op: "eq", value: "y" }, undefined)).toBe(false);
    expect(evaluateCondition({ attribute: "x", op: "eq", value: "y" }, {})).toBe(false);
    expect(evaluateCondition({ attribute: "x", op: "eq", value: "y" }, { x: null })).toBe(false);
  });
});

// =========================================================================
// Q3 enforcement: every rule using condition_match must have a fallback
// variant (one without condition_match) so missing/null evidence still
// resolves to a variant.
// =========================================================================

describe("condition_match — fallback enforcement (Q3)", () => {
  it("every rule that uses condition_match has at least one fallback variant without it", () => {
    const violators: string[] = [];
    for (const id of listMetadataRuleTypes()) {
      const r = getRuleMetadata(id)!;
      const usesCondition = r.fix.variants.some((v) => v.condition_match !== undefined);
      if (!usesCondition) continue;
      const hasFallback = r.fix.variants.some(
        (v) =>
          v.condition_match === undefined &&
          v.distro_match.includes("*") &&
          v.vendor_match.includes("*"),
      );
      if (!hasFallback) violators.push(id);
    }
    expect(
      violators,
      `Rules that use condition_match must include at least one ["*"]/["*"] variant WITHOUT condition_match so missing-evidence cases still resolve. Violators:\n  ${violators.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("ruleRegistry", () => {
  it("is non-empty (Phase 1 ships at least raid_degraded; Phase 2 grows it)", () => {
    expect(listMetadataRuleTypes().length).toBeGreaterThanOrEqual(1);
  });

  it("returns undefined for unknown rule types", () => {
    expect(getRuleMetadata("not_a_real_rule")).toBeUndefined();
  });

  it("registry is frozen-ish (lookup is stable)", () => {
    const a = ruleRegistry.get("raid_degraded");
    const b = ruleRegistry.get("raid_degraded");
    expect(a).toBe(b);
  });
});

describe("verdict_prior", () => {
  // Per Furnace static-priors spec (2026-05-20) and §2 of
  // GLASSMKR_NEXT_UP_QUEUE_2026-05-21.md. Two ends pinned:
  //   - schema accepts the three enum values + rejects anything else
  //   - assignment coverage stays at 100% across the rule library
  // If a future rule lands without a prior, the coverage test surfaces
  // it loudly so the new rule's contributor adds an entry to the
  // assignments table.

  it("schema accepts the three enum values when present", () => {
    const base = getRuleMetadata("raid_degraded");
    expect(base).toBeDefined();
    for (const v of ["recoverable", "investigation", "vendor-side"] as const) {
      const payload = {
        ...base,
        fix: { ...base!.fix, verdict_prior: v },
      };
      const parsed = RuleMetadataSchema.safeParse(payload);
      expect(parsed.success, `prior=${v} should validate`).toBe(true);
    }
  });

  it("schema rejects an unknown verdict_prior value", () => {
    const base = getRuleMetadata("raid_degraded");
    const payload = {
      ...base,
      fix: { ...base!.fix, verdict_prior: "bogus-value" },
    };
    const parsed = RuleMetadataSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("schema treats verdict_prior as optional", () => {
    const base = getRuleMetadata("raid_degraded");
    const fixWithout = { ...base!.fix } as Record<string, unknown>;
    delete fixWithout.verdict_prior;
    const payload = { ...base, fix: fixWithout };
    const parsed = RuleMetadataSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("every rule in the registry has a verdict_prior assigned", () => {
    const missing: string[] = [];
    for (const id of listMetadataRuleTypes()) {
      const r = getRuleMetadata(id);
      if (!r) continue;
      if (!r.fix.verdict_prior) missing.push(id);
    }
    expect(
      missing,
      `Every rule should have a verdict_prior. Add the rule to scripts/inject-verdict-prior.mjs's ASSIGNMENTS table and re-run the injector. Missing:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
