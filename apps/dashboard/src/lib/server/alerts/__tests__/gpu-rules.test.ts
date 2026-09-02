// Tests for the 8 GPU rules shipped 2026-05-20.
//
// Per CC_SPEC_GPU_RULES_2026-05-19.md. All 8 rules consume
// snap.gpu.tier1.* primarily; nvlink_link_down + gpu_corrected_ecc_
// storm + gpu_pcie_link_degraded also benefit from Tier 2 enrichment
// (which ships parser_quality=stub in v0.13.0).
//
// Capability gating: every rule degrades gracefully on hosts without
// NVIDIA GPUs (snap.gpu undefined or snap.gpu.available=false). Zero
// false positives, zero errors.

import { describe, expect, it } from "vitest";

import { evaluateAlerts, type AlertResult, type Snapshot } from "../evaluator";
import { healthySnapshot } from "./helpers";

function alertsByType(snap: Snapshot, type: string): AlertResult[] {
  return evaluateAlerts(snap).filter((a) => a.type === type);
}

type GpuFixture = NonNullable<NonNullable<Snapshot["gpu"]>["tier1"]>;
type GpuEntry = NonNullable<Extract<GpuFixture, { available: true }>["gpus"]>[number];

function gpuBase(overrides: Partial<GpuEntry> = {}): GpuEntry {
  return {
    index: 0,
    uuid: "GPU-test-uuid",
    name: "NVIDIA L4",
    pci_bdf: "0000:01:00.0",
    vbios_version: "95.02.66.00.04",
    vram_total_mib: 22528,
    vram_used_mib: 1024,
    temp_c: 50,
    power_draw_w: 25,
    power_limit_w: 72,
    utilization_gpu_percent: 0,
    utilization_mem_percent: 0,
    clock_graphics_mhz: 1230,
    clock_sm_mhz: 1230,
    clock_mem_mhz: 6250,
    pstate: "P8",
    pcie_link_gen_current: 4,
    pcie_link_gen_max: 4,
    pcie_link_width_current: 16,
    pcie_link_width_max: 16,
    ecc_mode_current: true,
    ecc_errors_corrected_volatile: 0,
    ecc_errors_corrected_aggregate: 0,
    ecc_errors_uncorrected_volatile: 0,
    ecc_errors_uncorrected_aggregate: 0,
    retired_pages_single_bit: 0,
    retired_pages_double_bit: 0,
    retired_pages_pending: 0,
    thermal_slowdown_active: false,
    thermal_violation_total_ms: null,
    power_violation_total_ms: null,
    fan_speed_percent: null,
    nvlink_links: [],
    performance_state_reasons: [],
    ...overrides,
  };
}

function gpuSnapshot(
  gpus: GpuEntry[],
  xidEvents: Array<{
    timestamp_iso: string;
    xid_code: number;
    pci_bdf: string;
    severity: "critical" | "warning" | "info";
    raw_message: string;
  }> = [],
): Snapshot {
  const s = healthySnapshot();
  s.system.uptime_seconds = 30 * 24 * 3600; // 30 days — above all boot graces
  s.gpu = {
    available: true,
    capabilities: {
      nvidia_smi: true,
      nvidia_driver_version: "550.54.15",
      dcgm: false,
      dcgmi_version: null,
      redfish_endpoint: null,
      redfish_oem_schema: null,
      probe_duration_ms: 50,
    },
    tier1: {
      available: true,
      gpus,
      xid_events: xidEvents,
      driver_version: "550.54.15",
    },
    tier2: { available: false, reason: "DCGM not active" },
    tier3: { available: false, reason: "stub in v0.13.0" },
  };
  return s;
}

// ============================================================================
// Capability gating: non-NVIDIA host
// ============================================================================

describe("GPU rules capability gating", () => {
  it("zero emissions on a non-NVIDIA host (snap.gpu undefined)", () => {
    const s = healthySnapshot();
    const gpuTypes = [
      "gpu_xid_critical",
      "gpu_uncorrected_ecc",
      "gpu_thermal_critical",
      "nvlink_link_down",
      "gpu_pcie_link_degraded",
      "gpu_power_cap_throttling",
      "gpu_driver_unsafe_reboot",
      "gpu_driver_or_firmware_drift",
      "gpu_corrected_ecc_storm",
    ];
    for (const type of gpuTypes) {
      expect(alertsByType(s, type).length).toBe(0);
    }
  });

  it("zero emissions when snap.gpu.available=false", () => {
    const s = healthySnapshot();
    s.gpu = {
      available: false,
      reason: "nvidia-smi not present",
      capabilities: {
        nvidia_smi: false,
        nvidia_driver_version: null,
        dcgm: false,
        dcgmi_version: null,
        redfish_endpoint: null,
        redfish_oem_schema: null,
        probe_duration_ms: 5,
      },
    };
    expect(alertsByType(s, "gpu_xid_critical").length).toBe(0);
    expect(alertsByType(s, "gpu_uncorrected_ecc").length).toBe(0);
  });
});

// ============================================================================
// gpu_driver_unsafe_reboot (nouveau reboot trap)
// ============================================================================

describe("gpu_driver_unsafe_reboot", () => {
  function withDriverResilience(
    dr: NonNullable<NonNullable<Snapshot["gpu"]>["driver_resilience"]>,
  ): Snapshot {
    const s = gpuSnapshot([gpuBase()]);
    s.gpu!.driver_resilience = dr;
    return s;
  }
  it("fires critical when NVIDIA hardware is present but the nvidia module is not loaded", () => {
    const fired = alertsByType(
      withDriverResilience({ nvidia_pci_present: true, nvidia_module_loaded: false, nouveau_module_loaded: true, nouveau_blacklisted: false }),
      "gpu_driver_unsafe_reboot",
    );
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });
  it("fires warning when nvidia is loaded but nouveau is not blacklisted (latent reboot risk)", () => {
    const fired = alertsByType(
      withDriverResilience({ nvidia_pci_present: true, nvidia_module_loaded: true, nouveau_module_loaded: false, nouveau_blacklisted: false }),
      "gpu_driver_unsafe_reboot",
    );
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
  });
  // Grok H-D3a/e: when the nvidia module is not loaded it may not be installed
  // at all; blacklisting nouveau without a driver leaves the GPU with no driver.
  // The FIX must lead with installing the driver.
  it("recommends installing the driver first when the nvidia module is not loaded", () => {
    const [a] = alertsByType(
      withDriverResilience({ nvidia_pci_present: true, nvidia_module_loaded: false, nouveau_module_loaded: true, nouveau_blacklisted: false }),
      "gpu_driver_unsafe_reboot",
    );
    expect(a.recommendation.toLowerCase()).toContain("driver is actually installed");
    expect(a.recommendation).toMatch(/nvidia-driver|nvidia-driver:latest-dkms/);
    // Codex round-1 #8: no `<version>` angle brackets (shell redirection when pasted).
    expect(a.recommendation).not.toContain("nvidia-driver-<version>");
    expect(a.recommendation).not.toMatch(/[<>]/);
  });
  it("does NOT prepend the install step when the driver is already loaded (only nouveau not blacklisted)", () => {
    const [a] = alertsByType(
      withDriverResilience({ nvidia_pci_present: true, nvidia_module_loaded: true, nouveau_module_loaded: false, nouveau_blacklisted: false }),
      "gpu_driver_unsafe_reboot",
    );
    expect(a.recommendation).toContain("Blacklist nouveau");
    expect(a.recommendation.toLowerCase()).not.toContain("driver is actually installed");
  });
  it("does not fire when nvidia is loaded and nouveau is blacklisted (reboot-safe)", () => {
    expect(alertsByType(
      withDriverResilience({ nvidia_pci_present: true, nvidia_module_loaded: true, nouveau_module_loaded: false, nouveau_blacklisted: true }),
      "gpu_driver_unsafe_reboot",
    ).length).toBe(0);
  });
  it("does not fire when there is no NVIDIA GPU on the host", () => {
    expect(alertsByType(
      withDriverResilience({ nvidia_pci_present: false, nvidia_module_loaded: false, nouveau_module_loaded: false, nouveau_blacklisted: false }),
      "gpu_driver_unsafe_reboot",
    ).length).toBe(0);
  });
});

// ============================================================================
// gpu_xid_critical
// ============================================================================

describe("gpu_xid_critical", () => {
  it("fires critical on a critical-severity XID event with the right metadata", () => {
    const s = gpuSnapshot(
      [gpuBase()],
      [
        {
          timestamp_iso: new Date().toISOString(),
          xid_code: 79,
          pci_bdf: "0000:01:00",
          severity: "critical",
          raw_message: "kernel: NVRM: Xid (PCI:0000:01:00): 79, GPU has fallen off the bus.",
        },
      ],
    );
    const fired = alertsByType(s, "gpu_xid_critical");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.xid_code).toBe(79);
    expect(fired[0].evidence.events_in_window).toBe(1);
    // Recommendation should be XID-79-specific (reseat first).
    expect(fired[0].recommendation).toMatch(/reseat/i);
  });

  it("groups multiple XID events of the same code into one emission", () => {
    const events = [1, 2, 3].map((n) => ({
      timestamp_iso: new Date(Date.now() - n * 60_000).toISOString(),
      xid_code: 79,
      pci_bdf: "0000:01:00",
      severity: "critical" as const,
      raw_message: `event ${n}`,
    }));
    const fired = alertsByType(gpuSnapshot([gpuBase()], events), "gpu_xid_critical");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.events_in_window).toBe(3);
  });

  it("does not fire on warning or info XID events", () => {
    const s = gpuSnapshot(
      [gpuBase()],
      [
        {
          timestamp_iso: new Date().toISOString(),
          xid_code: 32,
          pci_bdf: "0000:01:00",
          severity: "warning",
          raw_message: "non-critical XID",
        },
      ],
    );
    expect(alertsByType(s, "gpu_xid_critical").length).toBe(0);
  });
});

// ============================================================================
// gpu_uncorrected_ecc
// ============================================================================

describe("gpu_uncorrected_ecc", () => {
  // round-3: a lifetime (aggregate) uncorrected count with NONE since boot and
  // no retired/pending pages is a benign transient (box-17 L4 SRAM bit flip),
  // not an RMA. It surfaces as info, not a critical replace-the-GPU page.
  it("fires INFO on a lifetime uncorrected count with no since-boot errors or retired pages", () => {
    const s = gpuSnapshot([gpuBase({ ecc_errors_uncorrected_aggregate: 1 })]);
    const fired = alertsByType(s, "gpu_uncorrected_ecc");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("info");
  });

  it("fires critical when uncorrected errors are present since boot (volatile > 0)", () => {
    const s = gpuSnapshot([gpuBase({ ecc_errors_uncorrected_aggregate: 2, ecc_errors_uncorrected_volatile: 2 })]);
    const fired = alertsByType(s, "gpu_uncorrected_ecc");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });

  it("fires critical on double-bit retired pages > 0 (real VRAM remap)", () => {
    const s = gpuSnapshot([gpuBase({ retired_pages_double_bit: 3 })]);
    const fired = alertsByType(s, "gpu_uncorrected_ecc");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });

  it("fires on pending retirements > 0 (reboot pending)", () => {
    const s = gpuSnapshot([gpuBase({ retired_pages_pending: 2 })]);
    const fired = alertsByType(s, "gpu_uncorrected_ecc");
    expect(fired.length).toBe(1);
    expect(fired[0].message).toMatch(/reboot/i);
  });

  it("does not fire when ECC mode is disabled", () => {
    const s = gpuSnapshot([gpuBase({
      ecc_mode_current: false,
      ecc_errors_uncorrected_aggregate: 100, // would normally fire
    })]);
    expect(alertsByType(s, "gpu_uncorrected_ecc").length).toBe(0);
  });

  it("does not fire on healthy ECC state", () => {
    const s = gpuSnapshot([gpuBase()]);
    expect(alertsByType(s, "gpu_uncorrected_ecc").length).toBe(0);
  });
});

// ============================================================================
// gpu_thermal_critical
// ============================================================================

describe("gpu_thermal_critical", () => {
  it("fires critical at temp >= 92C", () => {
    const s = gpuSnapshot([gpuBase({ temp_c: 92 })]);
    const fired = alertsByType(s, "gpu_thermal_critical");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.temp_c).toBe(92);
  });

  // Round 5 (A6000 box-5): the card ran at its 84C thermal *target* under a
  // renter's near-full load with sw_thermal_slowdown + thermal_slowdown_active
  // set. That is normal driver target-holding (11C below the 95C HW slowdown,
  // fan at 59%), not a fault, and must NOT fire a critical thermal alert.
  it("does not fire on a software thermal slowdown at the thermal target (round-5 A6000 false alarm)", () => {
    const s = gpuSnapshot([gpuBase({
      temp_c: 84,
      thermal_slowdown_active: true,
      performance_state_reasons: ["sw_thermal_slowdown"],
    })]);
    expect(alertsByType(s, "gpu_thermal_critical").length).toBe(0);
  });

  it("does not fire below the 92C backstop with no hardware thermal slowdown", () => {
    expect(alertsByType(gpuSnapshot([gpuBase({ temp_c: 90 })]), "gpu_thermal_critical").length).toBe(0);
  });

  it("fires on hw_thermal_slowdown throttle reason", () => {
    const s = gpuSnapshot([gpuBase({
      temp_c: 80,
      performance_state_reasons: ["hw_thermal_slowdown"],
    })]);
    expect(alertsByType(s, "gpu_thermal_critical").length).toBe(1);
  });

  it("does not fire at temp 65C with no throttle", () => {
    expect(alertsByType(gpuSnapshot([gpuBase({ temp_c: 65 })]), "gpu_thermal_critical").length).toBe(0);
  });
});

// ============================================================================
// nvlink_link_down
// ============================================================================

describe("nvlink_link_down", () => {
  it("fires critical on a down NVLink in a multi-GPU host", () => {
    const s = gpuSnapshot([
      gpuBase({
        index: 0,
        nvlink_links: [
          { link_id: 0, state: "up", speed_gbps: 26.562 },
          { link_id: 1, state: "down", speed_gbps: 0 },
        ],
      }),
      gpuBase({ index: 1, pci_bdf: "0000:02:00.0", uuid: "GPU-uuid-2" }),
    ]);
    const fired = alertsByType(s, "nvlink_link_down");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.down_link_ids).toEqual([1]);
  });

  it("does not fire on a single-GPU host even with down links (capability gate)", () => {
    const s = gpuSnapshot([
      gpuBase({
        nvlink_links: [{ link_id: 0, state: "down", speed_gbps: 0 }],
      }),
    ]);
    expect(alertsByType(s, "nvlink_link_down").length).toBe(0);
  });

  it("does not fire on inactive (idle) links — only on down (fault)", () => {
    const s = gpuSnapshot([
      gpuBase({
        nvlink_links: [
          { link_id: 0, state: "up", speed_gbps: 26.562 },
          { link_id: 1, state: "inactive", speed_gbps: 0 },
        ],
      }),
      gpuBase({ index: 1, pci_bdf: "0000:02:00.0" }),
    ]);
    expect(alertsByType(s, "nvlink_link_down").length).toBe(0);
  });
});

// ============================================================================
// gpu_pcie_link_degraded
// ============================================================================

describe("gpu_pcie_link_degraded", () => {
  it("fires warning on gen-current below gen-max when GPU is busy", () => {
    const s = gpuSnapshot([gpuBase({ pcie_link_gen_current: 3, pcie_link_gen_max: 4, utilization_gpu_percent: 60, power_draw_w: 60 })]);
    const fired = alertsByType(s, "gpu_pcie_link_degraded");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
  });

  it("fires on width-current below width-max when GPU is busy", () => {
    const s = gpuSnapshot([gpuBase({ pcie_link_width_current: 8, pcie_link_width_max: 16, utilization_gpu_percent: 30, power_draw_w: 60 })]);
    expect(alertsByType(s, "gpu_pcie_link_degraded").length).toBe(1);
  });

  it("does not fire when both gen + width match max", () => {
    expect(alertsByType(gpuSnapshot([gpuBase()]), "gpu_pcie_link_degraded").length).toBe(0);
  });

  // Regression: 2026-05-21 cycle 3 design issue #6. PCIe ASPM drops
  // idle GPUs to Gen 1 x8 for power saving; the link renegotiates
  // under load. Without a utilization gate, the rule fires continuously
  // on every freshly-installed GPU host (confirmed on val-L4, val-
  // RTXA4000, val-A16). Suppress when utilization is below the floor.
  it("does NOT fire on degraded link when GPU utilization is below 5% (idle ASPM)", () => {
    const s = gpuSnapshot([gpuBase({
      pcie_link_gen_current: 1,
      pcie_link_gen_max: 4,
      pcie_link_width_current: 8,
      pcie_link_width_max: 16,
      utilization_gpu_percent: 0,
    })]);
    expect(alertsByType(s, "gpu_pcie_link_degraded").length).toBe(0);
  });

  it("fires on degraded link at the utilization floor (5%) — gate is gte", () => {
    const s = gpuSnapshot([gpuBase({
      pcie_link_gen_current: 3,
      pcie_link_gen_max: 4,
      utilization_gpu_percent: 5,
      power_draw_w: 60,
    })]);
    expect(alertsByType(s, "gpu_pcie_link_degraded").length).toBe(1);
  });

  // Regression (round 2): the reported fleet-wide FP. A marketplace A16 blips
  // above the utilization floor while idle/power-capped, with the PCIe link
  // ASPM-downshifted to x4/x16. Utilization alone clears the gate; the power-
  // draw signal (here ~24% of the cap) correctly identifies it as idle.
  it("does NOT fire on a degraded link when the GPU is power-capped at idle", () => {
    const s = gpuSnapshot([gpuBase({
      pcie_link_width_current: 4,
      pcie_link_width_max: 16,
      utilization_gpu_percent: 10,
      power_draw_w: 15,
      power_limit_w: 62.5,
    })]);
    expect(alertsByType(s, "gpu_pcie_link_degraded").length).toBe(0);
  });

  it("does not fire just under floor (4% util)", () => {
    const s = gpuSnapshot([gpuBase({
      pcie_link_gen_current: 3,
      pcie_link_gen_max: 4,
      utilization_gpu_percent: 4,
    })]);
    expect(alertsByType(s, "gpu_pcie_link_degraded").length).toBe(0);
  });

  it("does NOT fire on an x8 card in a physical x8 slot (current == slot max, benign) - the GPU host L4 2026-07-15", () => {
    // The L4 negotiates x8 because SLOT1 is electrically x8, not because the
    // link degraded. Slot-aware: current 8 == slot max 8, so no fire even under
    // load (Crucible 0.13.23 reports pcie_slot_max_width).
    const s = gpuSnapshot([gpuBase({
      pcie_link_width_current: 8,
      pcie_link_width_max: 16,
      pcie_slot_max_width: 8,
      utilization_gpu_percent: 40,
      power_draw_w: 60,
    })]);
    expect(alertsByType(s, "gpu_pcie_link_degraded").length).toBe(0);
  });

  it("fires on an x8 link in a physical x16 slot (current < slot max, real degradation)", () => {
    const s = gpuSnapshot([gpuBase({
      pcie_link_width_current: 8,
      pcie_link_width_max: 16,
      pcie_slot_max_width: 16,
      utilization_gpu_percent: 40,
      power_draw_w: 60,
    })]);
    const fired = alertsByType(s, "gpu_pcie_link_degraded");
    expect(fired.length).toBe(1);
    expect((fired[0].evidence as Record<string, unknown>).width_ceiling).toBe(16);
  });
});

// ============================================================================
// gpu_power_cap_throttling
// ============================================================================

describe("gpu_power_cap_throttling", () => {
  it("fires INFO on sw_power_cap (running at its power limit, expected for a power-capped card)", () => {
    const s = gpuSnapshot([gpuBase({ performance_state_reasons: ["sw_power_cap"] })]);
    const fired = alertsByType(s, "gpu_power_cap_throttling");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("info");
    expect((fired[0].evidence as Record<string, unknown>).power_cap_expected).toBe(true);
  });

  it("fires WARNING on hw_power_brake (hardware power event)", () => {
    const s = gpuSnapshot([gpuBase({ performance_state_reasons: ["hw_power_brake"] })]);
    const fired = alertsByType(s, "gpu_power_cap_throttling");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
  });

  it("does not fire on sw_thermal_slowdown (handled by gpu_thermal_critical)", () => {
    const s = gpuSnapshot([gpuBase({ performance_state_reasons: ["sw_thermal_slowdown"] })]);
    expect(alertsByType(s, "gpu_power_cap_throttling").length).toBe(0);
  });
});

// ============================================================================
// gpu_driver_or_firmware_drift
// ============================================================================

describe("gpu_driver_or_firmware_drift", () => {
  it("fires info when two GPUs of the same model have different vbios", () => {
    const s = gpuSnapshot([
      gpuBase({ index: 0, name: "NVIDIA L4", vbios_version: "95.02.66.00.04" }),
      gpuBase({
        index: 1,
        pci_bdf: "0000:02:00.0",
        uuid: "GPU-uuid-2",
        name: "NVIDIA L4",
        vbios_version: "95.02.67.00.01",
      }),
    ]);
    const fired = alertsByType(s, "gpu_driver_or_firmware_drift");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("info");
  });

  it("does not fire on single-GPU host", () => {
    expect(alertsByType(gpuSnapshot([gpuBase()]), "gpu_driver_or_firmware_drift").length).toBe(0);
  });

  it("does not fire when all GPUs share the same vbios", () => {
    const s = gpuSnapshot([
      gpuBase({ index: 0, vbios_version: "95.02.66.00.04" }),
      gpuBase({ index: 1, pci_bdf: "0000:02:00.0", uuid: "GPU-uuid-2", vbios_version: "95.02.66.00.04" }),
    ]);
    expect(alertsByType(s, "gpu_driver_or_firmware_drift").length).toBe(0);
  });

  it("does not fire when different GPU models have different vbios (mixed model is legit)", () => {
    const s = gpuSnapshot([
      gpuBase({ index: 0, name: "NVIDIA L4", vbios_version: "95.02.66.00.04" }),
      gpuBase({ index: 1, pci_bdf: "0000:02:00.0", uuid: "u2", name: "NVIDIA H100", vbios_version: "96.01.00.00.01" }),
    ]);
    expect(alertsByType(s, "gpu_driver_or_firmware_drift").length).toBe(0);
  });
});

// ============================================================================
// gpu_corrected_ecc_storm
// ============================================================================

describe("gpu_corrected_ecc_storm", () => {
  it("fires info on retired_pages_single_bit > 0", () => {
    const s = gpuSnapshot([gpuBase({ retired_pages_single_bit: 5 })]);
    const fired = alertsByType(s, "gpu_corrected_ecc_storm");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("info");
  });

  it("fires on volatile corrected counter > 1000", () => {
    const s = gpuSnapshot([gpuBase({ ecc_errors_corrected_volatile: 1500 })]);
    expect(alertsByType(s, "gpu_corrected_ecc_storm").length).toBe(1);
  });

  it("does not fire on healthy ECC state", () => {
    expect(alertsByType(gpuSnapshot([gpuBase()]), "gpu_corrected_ecc_storm").length).toBe(0);
  });

  it("does not fire when ECC mode is disabled", () => {
    const s = gpuSnapshot([gpuBase({
      ecc_mode_current: false,
      ecc_errors_corrected_volatile: 10000,
    })]);
    expect(alertsByType(s, "gpu_corrected_ecc_storm").length).toBe(0);
  });
});
