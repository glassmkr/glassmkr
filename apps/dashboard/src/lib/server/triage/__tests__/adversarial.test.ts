// Time bound for hostile pastes. analyze_server_output is anonymous and runs
// the parsers synchronously on the dashboard process that also serves agent
// ingest, so a paste that makes a regex or a scan super-linear stalls
// everything: review round 1 measured 13 to 87 s for a single 200 KB request
// on five different parser paths, and one 198 KB paste of nested brackets
// killed the process with a heap OOM (R1-1 to R1-5, R1-13, R1-36).
//
// Every input runs through analyzeOutput with no format hint and with a hint
// for each domain, because a hint forces that domain's parse() even when
// detect() does not match. Linear parsing of 200 KB takes a few milliseconds
// to a few tens of milliseconds; the bound leaves an order of magnitude for a
// slow CI runner, and any of the measured quadratic paths overshoots it many
// times over.

import { describe, expect, it, vi } from "vitest";
import { analyzeOutput } from "../analyze";
import type { TriageFormat } from "../types";
import { adversarialInputs } from "./adversarial-inputs";

const SIZE = 200_000;
const BUDGET_MS = 500;

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

describe("hostile 200 KB pastes stay linear", () => {
  for (const { name, text } of adversarialInputs(SIZE)) {
    it(name, () => {
      expect(text.length).toBeLessThanOrEqual(SIZE + 64);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        for (const formatHint of HINTS) {
          const started = performance.now();
          analyzeOutput(text, { formatHint });
          const elapsed = performance.now() - started;
          expect(elapsed, `${name} with hint ${formatHint ?? "none"}`).toBeLessThan(BUDGET_MS);
        }
      } finally {
        log.mockRestore();
      }
    });
  }
});
