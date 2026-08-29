import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_PRIORITIES, DEFAULT_PRIORITIES, PRIORITIES, priorityRecord, validPriorities } from "../priority";
import { expandChannelPriorities, getPriority } from "../presentation";

// The canonical model exists because the tier list was written out by hand in
// seven places that did not agree. These tests pin the two facts that were
// wrong, and then pin that nobody has gone back to writing their own list.

describe("the canonical tier set", () => {
  it("covers P0 through P4 in order of seriousness", () => {
    expect(ALL_PRIORITIES).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });

  it("defaults a channel to P0 through P3, leaving P4 off", () => {
    // P4 is where getPriority puts an info-severity instance so it shows
    // WITHOUT paging. Defaulting it on would page on exactly the instances the
    // tier exists to keep quiet. A previous pass turned it on for new channels.
    expect(DEFAULT_PRIORITIES).toEqual(["P0", "P1", "P2", "P3"]);
    expect(getPriority("unexpected_reboot", "info")).toBe(4);
    expect(DEFAULT_PRIORITIES).not.toContain("P4");
  });

  it("both dispatchers fall back to the canonical default, by import", () => {
    for (const rel of ["server/alerts/dispatcher.ts", "server/trend-warnings/dispatch.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
      expect(src).toMatch(/channel\.priorities \|\| DEFAULT_PRIORITIES/);
      expect(src).toMatch(/from "\$lib\/alerts\/priority"/);
    }
  });

  it("filters an untrusted list to real tiers, keeping canonical order", () => {
    expect(validPriorities(["P4", "P0", "nonsense", 7])).toEqual(["P0", "P4"]);
    expect(validPriorities("P0")).toEqual([]);
  });

  it("builds a checkbox record that tolerates stored legacy values", () => {
    expect(priorityRecord(["P1", "P2", "P3", "P4"])).toEqual({
      P0: false, P1: true, P2: true, P3: true, P4: true,
    });
  });

  it("shows the effective routing for a legacy row, not its stored list", () => {
    // A row stored before P0 existed lists P1 without P0 and the dispatcher
    // routes P0 to it anyway. The UI showed P1..P4 badges, hiding that.
    const stored = ["P1", "P2", "P3", "P4"];
    expect(priorityRecord(expandChannelPriorities(stored)).P0).toBe(true);
  });

  it("gives every tier a label, a meaning and a token colour", () => {
    for (const p of PRIORITIES) {
      expect(p.label).toMatch(/^P[0-4] /);
      expect(p.meaning.length).toBeGreaterThan(10);
      expect(p.color).toMatch(/^var\(--/); // a token, never a literal
    }
  });
});

describe("nobody writes their own tier list", () => {
  const files = [
    "src/routes/channels/+page.svelte",
    "src/routes/api/v1/channels/+server.ts",
    "src/routes/api/v1/channels/[id]/+server.ts",
    // The dispatchers were the last two holdouts: their hand-written fallbacks
    // disagreed with each other (P0..P3 vs P1..P4) after every other surface
    // had been converted.
    "src/lib/server/alerts/dispatcher.ts",
    "src/lib/server/trend-warnings/dispatch.ts",
  ];
  it.each(files)("%s has no hand-written priority array", (rel) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", rel), "utf8");
    // Strip comments: they legitimately describe the history of these arrays.
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\[\s*"P[0-4]"\s*,\s*"P[0-4]"/);
    expect(code).toMatch(/from "\$lib\/alerts\/priority"/);
  });
});
