// analyzeOutput with the real parsers, for the answer-shaping fixes from
// review round 1 (2026-10-03): SEL event age (R1-9, R1-10), recoverable SCSI
// sense keys (R1-17), PCIe width without the slot width (R1-19), shell
// placeholders in fix commands (R1-20), what the answer carries (R1-22), a
// text block that stands on its own (R1-24), and dashboard-only rule wording
// (R1-29).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOutput, renderAnalysisText, triageRuleCopy } from "../analyze";
import { TRIAGE_PARSERS } from "../registry";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (path: string) => readFileSync(join(FIXTURES, path), "utf8");

beforeEach(() => {
  // psu_redundancy_loss logs its decision path on every evaluation.
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function sel(rows: string[]): string {
  return ["root@node-t1:~# ipmitool sel elist", ...rows].join("\n");
}

describe("SEL events from an unset BMC clock still count (R1-9)", () => {
  for (const date of ["01/01/2000", "01/01/70", "03/14/2015"]) {
    it(`critical rows dated ${date} fire ipmi_sel_critical`, () => {
      const a = analyzeOutput(
        sel([
          `   1 | ${date} | 00:00:12 | Power Supply PS2 Status | Failure detected | Asserted`,
          `   2 | ${date} | 00:00:13 | Fan FAN3 | Lower Critical going low | Asserted`,
          `   3 | ${date} | 00:00:14 | Temperature CPU1 Temp | Upper Critical going high | Asserted`,
        ]),
      );
      const f = a.findings.find((x) => x.rule_id === "ipmi_sel_critical");
      expect(f?.severity).toBe("critical");
      expect(String(f?.observed.affected_components)).toContain("PS2 Status");
    });
  }
});

describe("SEL event age is in the answer (R1-10)", () => {
  const paste = sel([
    "   1 | 03/14/2022 | 02:11:05 | Power Supply PS1 Status | Power Supply AC lost | Asserted",
    "   2 | 03/14/2022 | 04:47:31 | Power Supply PS1 Status | Power Supply AC lost | Deasserted",
    "   3 | 03/14/2022 | 04:47:33 | Power Unit Redundancy | Fully Redundant | Asserted",
  ]);
  const a = analyzeOutput(paste);
  const f = a.findings.find((x) => x.rule_id === "ipmi_sel_critical")!;

  it("carries the event dates and the later deassertion as scalars", () => {
    expect(f.observed).toMatchObject({
      oldest_critical_event: "2022-03-14T02:11:05Z",
      newest_critical_event: "2022-03-14T02:11:05Z",
      critical_events_counted: 1,
      critical_events_later_deasserted: 1,
    });
    expect(f.observed).not.toHaveProperty("total_events_in_sel");
  });

  it("does not claim a 30-day window", () => {
    expect(f.summary).not.toMatch(/last N days|default 30/);
  });

  it("says whether the fault is still present cannot be told from the log", () => {
    expect(a.not_determinable.map((n) => n.signal)).toContain("Whether the SEL fault is still present");
    const text = renderAnalysisText(a);
    expect(text).toContain("oldest_critical_event=2022-03-14T02:11:05Z");
    expect(text).toMatch(/later deasserted/);
  });

  it("a recent event without a deassertion is not marked historical", () => {
    const b = analyzeOutput(sel(["   1 | 09/28/2026 | 14:23:05 | Power Supply PS1 Status | Power Supply AC lost | Asserted"]));
    expect(b.not_determinable.map((n) => n.signal)).not.toContain("Whether the SEL fault is still present");
  });
});

describe("recoverable SCSI sense keys (R1-17)", () => {
  it("a Not Ready sense key is a warning that says it is recoverable", () => {
    const a = analyzeOutput("[ 12.000000] sd 2:0:0:0: [sdc] tag#3 Sense Key : Not Ready [current]\n");
    const f = a.findings.find((x) => x.rule_id === "disk_io_errors")!;
    expect(f.severity).toBe("warning");
    expect(f.observed.severity_basis).toBe("recoverable_sense_key");
    expect(f.summary).not.toMatch(/prevent data loss/);
  });

  it("the ATA pass-through noise in a journalctl paste raises no disk finding", () => {
    const a = analyzeOutput(fixture("kernel_log/synthetic-journalctl-k-ata-passthrough-noise.txt"));
    expect(a.findings.map((f) => f.rule_id)).not.toContain("disk_io_errors");
  });
});

describe("PCIe width with no slot width in the paste (R1-19)", () => {
  it("a loaded L4 at x8 of x16 with the generation intact is info, not a warning", () => {
    const a = analyzeOutput(fixture("nvidia_gpu/synthetic-l4-x8-slot-csv.txt"));
    const f = a.findings.find((x) => x.rule_id === "gpu_pcie_link_degraded")!;
    expect(f.severity).toBe("info");
    expect(f.observed.width_ceiling_basis).toBe("card_max_slot_unknown");
  });

  it("a generation downtrain stays a warning", () => {
    const a = analyzeOutput(fixture("nvidia_gpu/synthetic-failing-a100-q.txt"));
    expect(a.findings.find((x) => x.rule_id === "gpu_pcie_link_degraded")?.severity).toBe("warning");
  });
});

describe("fix commands carry no unfilled template (R1-20)", () => {
  const TEMPLATE = /\$\{[A-Z_]+\}|\{\{\w+\}\}/;

  it("smart_failing names the drive in its commands", () => {
    const a = analyzeOutput(fixture("smart/ata-hdd-failing-a.txt"));
    const f = a.findings.find((x) => x.rule_id === "smart_failing")!;
    const fix = JSON.stringify(f.fix);
    expect(fix).not.toMatch(TEMPLATE);
    expect(fix).toContain("smartctl -a /dev/sdc");
  });

  it("disk_io_errors fills the device list", () => {
    const a = analyzeOutput(fixture("kernel_log/dmesg-T-sata-medium-error.txt"));
    for (const f of a.findings.filter((x) => x.rule_id === "disk_io_errors")) {
      expect(JSON.stringify(f.fix)).not.toMatch(TEMPLATE);
    }
  });

  it("a drive the paste never named gets a visible placeholder and a step that says to fill it in", () => {
    const text = fixture("smart/ata-hdd-failing-a.txt").split("\n").filter((l) => !/^root@/.test(l)).join("\n");
    const f = analyzeOutput(text).findings.find((x) => x.rule_id === "smart_failing")!;
    expect(JSON.stringify(f.fix)).not.toMatch(TEMPLATE);
    expect(f.fix?.steps?.[0].title).toMatch(/^Replace <device> in the commands below/);
  });

  it("the ipmi_sel_critical explanation names the components instead of a token", () => {
    const a = analyzeOutput(fixture("ipmi_sel/synthetic-failing-sel-elist.txt"));
    const f = a.findings.find((x) => x.rule_id === "ipmi_sel_critical")!;
    expect(f.fix?.quick_check?.explanation).not.toMatch(TEMPLATE);
    expect(f.fix?.quick_check?.explanation).toContain(String(f.observed.affected_components));
  });
});

describe("what the answer carries (R1-22)", () => {
  it("no content hash, and the monitoring link only when something was read", () => {
    const none = analyzeOutput("is my server ok?");
    expect(none.input).not.toHaveProperty("sha256_prefix");
    expect(none).not.toHaveProperty("continuous_monitoring");
    const some = analyzeOutput(fixture("mdraid/mdstat-raid1-failed.txt"));
    expect(some.continuous_monitoring?.docs_url).toBe("https://glassmkr.com/docs/getting-started?ref=mcp-triage");
  });
});

describe("the text block stands on its own (R1-24)", () => {
  it("an unrecognised paste lists the commands to run", () => {
    const a = analyzeOutput("is my server ok?");
    const text = renderAnalysisText(a);
    expect(a.next_capture.length).toBeGreaterThan(0);
    for (const c of a.next_capture) for (const cmd of c.command.split("\n")) expect(text).toContain(cmd);
    expect(text).not.toMatch(/in next_capture/);
  });

  it("a degraded array names the failed member and the quick check", () => {
    const a = analyzeOutput(fixture("mdraid/mdstat-raid1-failed.txt"));
    const f = a.findings.find((x) => x.rule_id === "raid_degraded")!;
    const text = renderAnalysisText(a);
    expect(text).toContain(`failed_disks=${f.observed.failed_disks}`);
    expect(text).toContain(f.fix!.quick_check!.command.split("\n")[0]);
    for (const c of a.next_capture) expect(text).toContain(c.command.split("\n")[0]);
  });
});

describe("rule wording in a paste answer (R1-29)", () => {
  const rules = [...new Set(TRIAGE_PARSERS.flatMap((p) => p.rules))];
  const DASHBOARD_ONLY = /dashboard|server detail page|fleet|acknowledge|boot grace|typically precede|in the last N days|default 30|over 30 days/i;

  for (const rule of rules) {
    it(`${rule} speaks to one paste, not to the dashboard`, () => {
      const copy = triageRuleCopy(rule);
      expect(copy.summary).not.toMatch(DASHBOARD_ONLY);
      expect(copy.quick_check?.command ?? "").not.toMatch(DASHBOARD_ONLY);
      expect(copy.quick_check?.explanation ?? "").not.toMatch(DASHBOARD_ONLY);
    });
  }
});
