// Time bound for hostile pastes. analyze_server_output is anonymous and runs
// the parsers synchronously on the dashboard process that also serves agent
// ingest, so a paste that makes a regex or a scan super-linear stalls
// everything: review round 1 measured 13 to 87 s for a single 200 KB request
// on five different parser paths, and one 198 KB paste of nested brackets
// killed the process with a heap OOM (R1-1 to R1-5, R1-13, R1-36).
//
// Every input runs through analyzeOutput with no format hint and with a hint
// for each domain, because a hint forces that domain's parse() even when
// detect() does not match.
//
// The bound is relative to a realistic paste of the same size timed on the
// same machine first. A flat 500 ms let R2-1 through: a regex that is
// quadratic inside the 2048-character line cap still scales linearly with the
// number of lines, and cost 300 to 900 ms per 200 KB call against about 10 ms
// for a normal kernel log, which keeps the shared process busy at the
// per-network rate limit. Linear hostile inputs stay within a few times the
// baseline; the floor absorbs timer noise on a fast machine.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeOutput } from "../analyze";
import type { TriageFormat } from "../types";
import { adversarialInputs, roundFourInputs } from "./adversarial-inputs";

const SIZE = 200_000;
const BUDGET_RATIO = 20;
const BUDGET_FLOOR_MS = 150;
const FIXTURES = new URL("./fixtures/", import.meta.url);
const BASELINE_FIXTURES = [
  "kernel_log/dmesg-healthy-boot.txt",
  "smart/ata-hdd-healthy-a.txt",
  "zfs/healthy-rpool-mirror.txt",
  "mdraid/mdstat-healthy.txt",
  "ipmi_sel/synthetic-healthy.txt",
  "nvidia_gpu/synthetic-healthy-h100x2-q.txt",
];

// One format per domain: the hint only decides which domain's parser runs.
const HINTS: Array<TriageFormat | undefined> = [
  undefined,
  "smartctl_text",
  "zpool_status",
  "proc_mdstat",
  "dmesg",
  "ipmitool_sel_elist",
  "nvidia_smi_query",
];

/** Slowest hint for one paste, in ms. */
function slowestHint(text: string): number {
  let slowest = 0;
  for (const formatHint of HINTS) {
    const started = performance.now();
    analyzeOutput(text, { formatHint });
    slowest = Math.max(slowest, performance.now() - started);
  }
  return slowest;
}

describe("hostile 200 KB pastes stay linear", () => {
  let budgetMs = BUDGET_FLOOR_MS;

  beforeAll(() => {
    const unit = BASELINE_FIXTURES.map((f) => readFileSync(new URL(f, FIXTURES), "utf8")).join("\n");
    const realistic = unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The fastest of three runs, so a JIT warm-up or a GC pause does not
      // inflate the budget.
      const baseline = Math.min(slowestHint(realistic), slowestHint(realistic), slowestHint(realistic));
      budgetMs = Math.max(BUDGET_FLOOR_MS, BUDGET_RATIO * baseline);
    } finally {
      log.mockRestore();
    }
  });

  for (const { name, text } of adversarialInputs(SIZE)) {
    it(name, () => {
      expect(text.length).toBeLessThanOrEqual(SIZE + 64);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        for (const formatHint of HINTS) {
          const started = performance.now();
          analyzeOutput(text, { formatHint });
          const elapsed = performance.now() - started;
          expect(elapsed, `${name} with hint ${formatHint ?? "none"} (budget ${budgetMs.toFixed(0)} ms)`).toBeLessThan(budgetMs);
        }
      } finally {
        log.mockRestore();
      }
    });
  }
});

// R4-14: the SEL component list was deduplicated with Array.includes, so a
// paste of distinct sensors cost about five times one of a single sensor while
// staying under the absolute budget above. The ratio pins it.
describe("a SEL of distinct sensors costs about what one sensor does (R4-14)", () => {
  it("distinct vs one sensor, 200 KB", () => {
    const distinct = roundFourInputs(SIZE).find((i) => i.name === "ipmi: SEL of critical rows with distinct sensors")!.text;
    const same = distinct.replace(/Memory #0x[0-9a-f]{4}/g, "Memory #0x0002");
    const best = (text: string) => {
      let ms = Infinity;
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        analyzeOutput(text, { formatHint: "ipmitool_sel_elist" });
        ms = Math.min(ms, performance.now() - started);
      }
      return ms;
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      best(same);
      expect(best(distinct)).toBeLessThan(3 * best(same) + 5);
    } finally {
      log.mockRestore();
    }
  });
});
