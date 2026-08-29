import { describe, it, expect } from "vitest";
import { alertIsVendorFacing, OWNERSHIP_REMEDIATION_NOTE } from "$lib/alerts/vendor-facing";
import { buildDraftFacts } from "../facts";
import { assembleDraft } from "../assemble";
import { templateProse } from "../template";
import { parseProse, proseLeaksFacts } from "../gemma";
import { buildTicketDraft } from "../build";
import type { DraftAlert, DraftServer } from "../types";

const SERVER: DraftServer = {
  name: "web-01",
  ip: "203.0.113.10",
  dmi_vendor: "Supermicro",
  dmi_product: "X12STD-F",
  os_type: "Ubuntu",
  os_version: "24.04",
};

const NOW = Date.parse("2026-06-16T12:00:00Z");

function smartAlert(evidence: Record<string, unknown>): DraftAlert {
  return {
    alert_type: "smart_failing",
    severity: "critical",
    title: "SMART failure on /dev/sdb",
    first_seen: "2026-06-16T10:00:00Z",
    evidence,
  };
}

describe("alertIsVendorFacing", () => {
  it("true when the recommendation carries the ownership note", () => {
    expect(alertIsVendorFacing(`Replace the drive. ${OWNERSHIP_REMEDIATION_NOTE}`)).toBe(true);
  });
  it("false for a recommendation without the note, or empty", () => {
    expect(alertIsVendorFacing("Restart the service.")).toBe(false);
    expect(alertIsVendorFacing(null)).toBe(false);
    expect(alertIsVendorFacing(undefined)).toBe(false);
  });
});

describe("buildDraftFacts", () => {
  it("includes server identity, alert meta, and the drive serial verbatim", () => {
    const f = buildDraftFacts(SERVER, smartAlert({ device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", firmware: "M3CR046", pending_sectors: 1 }), NOW);
    const byLabel = Object.fromEntries(f.facts.map((x) => [x.label, x.value]));
    expect(byLabel["Server name"]).toBe("web-01");
    expect(byLabel["Hardware model"]).toBe("X12STD-F");
    expect(byLabel["Serial number"]).toBe("2315E6C685B0");
    expect(byLabel["Pending sectors"]).toBe("1");
    expect(byLabel["First detected"]).toContain("2026-06-16T10:00:00");
    expect(byLabel["First detected"]).toContain("2 hours ago");
    expect(f.appendixCommand).toBe("smartctl -a /dev/sdb");
    expect(f.faultLabel).toBe("failing drive (SMART)");
  });

  it("marks the serial 'not reported' when the agent did not send it (pre-roll)", () => {
    const f = buildDraftFacts(SERVER, smartAlert({ device: "/dev/sdb", model: "X" }), NOW);
    const serial = f.facts.find((x) => x.label === "Serial number");
    expect(serial?.value).toContain("not reported");
  });

  it("nvme_wear_high: quotes the unit identity and the SMART wear numbers a provider can verify", () => {
    // Simon 2026-07-02: the bare draft ("hardware fault ... endurance at 75%")
    // gave a hoster nothing to act on; they will ask for smartctl output. The
    // draft must carry model + serial + the wear/health readings verbatim.
    const alert: DraftAlert = {
      alert_type: "nvme_wear_high",
      severity: "info",
      title: "Drive /dev/sdb endurance at 75% used",
      first_seen: "2026-07-01T15:04:34Z",
      evidence: {
        device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", firmware: "M3CR046",
        percentage_used: 75, power_on_hours: 32148,
        health: "PASSED", reallocated_sectors: 0, pending_sectors: 0,
      },
    };
    const f = buildDraftFacts(SERVER, alert, NOW);
    const byLabel = Object.fromEntries(f.facts.map((x) => [x.label, x.value]));
    expect(byLabel["Drive model"]).toBe("CT500MX500SSD1");
    expect(byLabel["Serial number"]).toBe("2315E6C685B0");
    expect(byLabel["Firmware"]).toBe("M3CR046");
    expect(byLabel["Rated write endurance used"]).toContain("75%");
    expect(byLabel["Power-on hours"]).toBe("32148");
    expect(byLabel["SMART health"]).toBe("PASSED");
    expect(byLabel["Reallocated sectors"]).toBe("0");
    expect(byLabel["Pending sectors"]).toBe("0");
    expect(f.appendixCommand).toBe("smartctl -a /dev/sdb");
    expect(f.faultLabel).toBe("drive at end of rated write endurance");

    // Subject must not degrade to the doubled "hardware fault ... : hardware fault".
    const d = assembleDraft(f, templateProse("nvme_wear_high"), "template");
    expect(d.subject).toBe("Hardware fault on web-01 (X12STD-F): drive at end of rated write endurance");
    expect(d.body).toContain("rated write endurance");
    expect(d.body).toContain("smartctl -a /dev/sdb");
  });

  it("disk_io_errors: names the physical unit via the SMART join", () => {
    const alert: DraftAlert = {
      alert_type: "disk_io_errors",
      severity: "critical",
      title: "3 I/O error(s) on sdb",
      first_seen: "2026-07-01T15:04:34Z",
      evidence: {
        scope: "io_errors_count", count: 3, devices: ["sdb"],
        affected_drives: [{ device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", firmware: "M3CR046" }],
      },
    };
    const f = buildDraftFacts(SERVER, alert, NOW);
    const drive = f.facts.find((x) => x.label === "Affected drive");
    expect(drive?.value).toBe("/dev/sdb (CT500MX500SSD1, serial 2315E6C685B0)");
    expect(f.appendixCommand).toBe("smartctl -a /dev/sdb");
  });

  it("disk_io_errors: flags unresolved drive identity instead of silently omitting it", () => {
    const alert: DraftAlert = {
      alert_type: "disk_io_errors",
      severity: "critical",
      title: "SCSI sense: Medium Error on sdc",
      first_seen: "2026-07-01T15:04:34Z",
      evidence: { scope: "scsi_sense", device: "sdc", sense_key: "Medium Error", affected_drives: [] },
    };
    const f = buildDraftFacts(SERVER, alert, NOW);
    const id = f.facts.find((x) => x.label === "Drive identity");
    expect(id?.value).toContain("not resolved");
  });
});

describe("assembleDraft", () => {
  const facts = buildDraftFacts(SERVER, smartAlert({ device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", pending_sectors: 1 }), NOW);

  it("produces plain text with no markdown and no Glassmkr branding", () => {
    const d = assembleDraft(facts, templateProse("smart_failing"), "template");
    expect(d.body).not.toMatch(/[*#`]/);
    expect(d.body).not.toMatch(/glassmkr/i);
    expect(d.subject).not.toMatch(/glassmkr/i);
    expect(d.body).not.toMatch(/drafted by|generated by|powered by/i);
  });

  it("prints the serial in the fact block and uses the subject format", () => {
    const d = assembleDraft(facts, templateProse("smart_failing"), "template");
    expect(d.subject).toBe("Hardware fault on web-01 (X12STD-F): failing drive (SMART)");
    expect(d.body).toContain("Serial number: 2315E6C685B0");
    expect(d.body).toContain("smartctl -a /dev/sdb");
  });
});

describe("templateProse", () => {
  it("has prose for every gated alert type", () => {
    for (const t of ["smart_failing", "nvme_critical_warning", "nvme_wear_high", "raid_degraded", "ecc_errors", "mce_uncorrected", "psu_redundancy_loss", "ipmi_fan_failure", "cpu_temperature_high", "disk_io_errors"]) {
      const p = templateProse(t);
      expect(p.opening.length).toBeGreaterThan(0);
      expect(p.request.length).toBeGreaterThan(0);
    }
  });
  it("every request tells the provider to confirm hot-swap or coordinate a maintenance window", () => {
    // Simon 2026-07-02: a provider acting on the ticket must either confirm
    // the part is hot-swappable or arrange downtime with the customer before
    // pulling hardware; every template (and the default) must say so.
    for (const t of ["smart_failing", "nvme_critical_warning", "nvme_wear_high", "raid_degraded", "ecc_errors", "mce_uncorrected", "psu_redundancy_loss", "ipmi_fan_failure", "cpu_temperature_high", "disk_io_errors", "some_future_type"]) {
      expect(templateProse(t).request).toMatch(/maintenance window/i);
    }
  });

  it("falls back to a generic but usable default for an unknown type", () => {
    expect(templateProse("something_new").opening).toContain("hardware fault");
  });

  it("request and impact prose never say 'below' (the fact block renders above them)", () => {
    // The assembler prints the fact block second, right after the opening, so it
    // sits ABOVE impact/request. Only the opening may point to details 'below'.
    // A request/impact that says 'below' sends the reader past the end of the
    // message. Guards the smart/nvme/default "listed below" -> "listed above"
    // fix (2026-06-16).
    for (const t of ["smart_failing", "nvme_critical_warning", "raid_degraded", "ecc_errors", "mce_uncorrected", "psu_redundancy_loss", "ipmi_fan_failure", "cpu_temperature_high", "disk_io_errors", "unknown_type_default"]) {
      const p = templateProse(t);
      expect(p.request.toLowerCase()).not.toContain("below");
      expect(p.impact.toLowerCase()).not.toContain("below");
    }
  });
});

describe("parseProse / hallucination guard", () => {
  it("keeps clean prose fields", () => {
    const out = parseProse(JSON.stringify({ opening: "Monitoring detected a likely drive fault.", impact: "The drive may fail.", request: "Please replace it.", closing: "Thanks." }));
    expect(out).toEqual({ opening: "Monitoring detected a likely drive fault.", impact: "The drive may fail.", request: "Please replace it.", closing: "Thanks." });
  });

  it("extracts the JSON even when a reasoning model wraps it in a trace", () => {
    const wrapped = `Let me reason about this fault first. The drive is failing.\n{"opening":"Monitoring detected a fault.","impact":"It may fail.","request":"Please replace it.","closing":"Thanks."}\nThat is my final answer.`;
    const out = parseProse(wrapped);
    expect(out?.opening).toBe("Monitoring detected a fault.");
    expect(out?.request).toBe("Please replace it.");
  });

  it("rejects a segment that leaks a serial-like digit or hex run", () => {
    expect(proseLeaksFacts("the drive serial 2315E6C685B0 is failing")).toBe(true); // hex run
    expect(proseLeaksFacts("error count 9999999 observed")).toBe(true); // digit run
    expect(proseLeaksFacts("the listed drive is failing")).toBe(false);
    const out = parseProse(JSON.stringify({ opening: "Drive SN 2315E6C685B0 is bad.", impact: "It may fail.", request: "Replace it.", closing: "Thanks." }));
    expect(out?.opening).toBeUndefined(); // leaked segment dropped
    expect(out?.impact).toBe("It may fail.");
  });

  it("a hallucinated wrong serial in prose never reaches the assembled draft", () => {
    const facts = buildDraftFacts(SERVER, smartAlert({ device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", pending_sectors: 1 }), NOW);
    const template = templateProse("smart_failing");
    // Model hallucinated a different serial in the impact field; the guard drops it.
    const g = parseProse(JSON.stringify({ opening: "Monitoring detected a drive fault.", impact: "The failing drive, serial 0000000DEADBEEF, must be replaced.", request: "Please replace it.", closing: "Thanks." }));
    expect(g?.impact).toBeUndefined();
    const prose = { opening: g?.opening ?? template.opening, impact: g?.impact ?? template.impact, request: g?.request ?? template.request, closing: g?.closing ?? template.closing };
    const d = assembleDraft(facts, prose, "gemma");
    expect(d.body).toContain("Serial number: 2315E6C685B0"); // real, server-injected
    expect(d.body).not.toContain("0000000DEADBEEF"); // hallucinated value excluded
  });
});

describe("buildTicketDraft (no LLM configured in test env)", () => {
  it("returns a complete template draft with real facts and source=template", async () => {
    const d = await buildTicketDraft(SERVER, smartAlert({ device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", pending_sectors: 1 }), NOW);
    expect(d.source).toBe("template");
    expect(d.body).toContain("Serial number: 2315E6C685B0");
    expect(d.body).not.toMatch(/glassmkr/i);
    expect(d.subject).toContain("web-01");
  });
});

describe("buildDraftFacts raid_degraded", () => {
  function raidAlert(evidence: Record<string, unknown>): DraftAlert {
    return { alert_type: "raid_degraded", severity: "critical", title: "RAID md127 degraded", first_seen: "2026-06-16T10:00:00Z", evidence };
  }

  it("names the failed member with model + serial when resolved, and offers a smartctl command", () => {
    const f = buildDraftFacts(SERVER, raidAlert({
      raid_kind: "mdadm", device: "md127", level: "raid1", failed_disks: ["sdb2"],
      failed_members: [{ member: "sdb2", device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0" }],
    }), NOW);
    const byLabel = Object.fromEntries(f.facts.map((x) => [x.label, x.value]));
    expect(byLabel["Failed member"]).toBe("/dev/sdb (CT500MX500SSD1, serial 2315E6C685B0)");
    expect(f.appendixCommand).toBe("smartctl -a /dev/sdb");
  });

  it("falls back to the member name with no command when the disk is gone from SMART", () => {
    const f = buildDraftFacts(SERVER, raidAlert({
      raid_kind: "mdadm", device: "md127", level: "raid1", failed_disks: ["sdb2"],
      failed_members: [{ member: "sdb2", device: null, model: null, serial: null }],
    }), NOW);
    const byLabel = Object.fromEntries(f.facts.map((x) => [x.label, x.value]));
    expect(byLabel["Failed member"]).toBe("sdb2");
    expect(f.appendixCommand).toBeUndefined();
  });

  it("surfaces the controller identity + state for hardware RAID (no per-disk serial)", () => {
    const f = buildDraftFacts(SERVER, raidAlert({
      raid_kind: "hardware", controller_vendor: "dell", controller_id: "0", controller_state: "Degraded", degraded_disks: 1,
    }), NOW);
    const byLabel = Object.fromEntries(f.facts.map((x) => [x.label, x.value]));
    expect(byLabel["Controller"]).toBe("dell controller 0");
    expect(byLabel["Controller state"]).toBe("Degraded");
    expect(byLabel["Degraded disks"]).toBe("1");
    expect(f.appendixCommand).toBeUndefined();
  });
});

describe("buildDraftFacts component extractors (fan / psu / cpu / ecc)", () => {
  const facts = (alert_type: string, title: string, evidence: Record<string, unknown>) =>
    Object.fromEntries(buildDraftFacts(SERVER, { alert_type, severity: "critical", title, first_seen: "2026-06-16T10:00:00Z", evidence }, NOW).facts.map((x) => [x.label, x.value]));

  it("ipmi_fan_failure names each failed fan with RPM", () => {
    const b = facts("ipmi_fan_failure", "Fan failure: 1 of 6 fans", { failed_fans: [{ name: "FAN3", rpm: 0, status: "cr" }], total_fans: 6 });
    expect(b["Failed fan(s)"]).toBe("FAN3 (0 RPM)");
    expect(b["Total fans"]).toBe("6");
  });

  it("psu_redundancy_loss names the failed PSU (per-PSU path)", () => {
    const b = facts("psu_redundancy_loss", "PSU redundancy lost", { failed: [{ name: "PSU2", status: "cr", value: "0" }], total_psus: 2, path: "per-psu-fault" });
    expect(b["Failed PSU(s)"]).toBe("PSU2 (cr)");
    expect(b["Total PSUs"]).toBe("2");
  });

  it("psu_redundancy_loss surfaces the redundancy state (Dell aggregate path)", () => {
    const b = facts("psu_redundancy_loss", "PSU redundancy lost", { aggregate_state: "redundancy_lost", path: "aggregate-redundancy" });
    expect(b["Redundancy state"]).toBe("redundancy lost");
    expect(b["Failed PSU(s)"]).toBeUndefined();
  });

  it("cpu_temperature_high names the sensor + reading (IPMI path, unit normalized)", () => {
    const b = facts("cpu_temperature_high", "CPU1 Temp: 94°C", { path: "ipmi", sensor: "CPU1 Temp", value: 94, unit: "degrees C" });
    expect(b["Sensor"]).toBe("CPU1 Temp");
    expect(b["Temperature"]).toBe("94 °C");
  });

  it("cpu_temperature_high uses the hwmon source when there is no IPMI sensor", () => {
    const b = facts("cpu_temperature_high", "CPU thermal: 92°C", { path: "hwmon", source: "coretemp Package id 0", value: 92, unit: "°C" });
    expect(b["Sensor"]).toBe("coretemp Package id 0");
    expect(b["Temperature"]).toBe("92 °C");
  });

  it("ecc_errors names the affected DIMM(s) when EDAC has per-module detail", () => {
    const b = facts("ecc_errors", "2 uncorrectable ECC error(s)", {
      max_uncorrectable: 2, source: "edac",
      edac: { correctable: 0, uncorrectable: 2, dimms_with_errors: [{ label: "DIMM_A1", location: "CPU0 channel1 slot0", ce_count: 0, ue_count: 2 }] },
    });
    expect(b["Affected DIMM(s)"]).toBe("DIMM_A1 (CPU0 channel1 slot0)");
    expect(b["Uncorrectable error count"]).toBe("2");
  });

  it("ecc_errors adds nothing component-specific on the IPMI/SEL-only path (no per-DIMM data)", () => {
    const b = facts("ecc_errors", "40 correctable ECC error(s) in last 24h", {
      evaluation: "rate_based", current_correctable: 40, edac: null, path: "ipmi_sel",
    });
    expect(b["Affected DIMM(s)"]).toBeUndefined();
    expect(b["Alert"]).toBe("40 correctable ECC error(s) in last 24h"); // common facts + title still present
  });
});
