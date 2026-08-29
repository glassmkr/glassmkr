// Synthetic snap.gpu fixture for an NVIDIA RTX A4000 workstation
// single-GPU host (16 GB GDDR6, 140W max TDP, PCIe Gen 4 x16,
// ECC supported but defaults to OFF on workstation cards).
//
// Matches glassmkr-val-RTXA4000 hardware. Built against the
// Tier1Snapshot type from Crucible v0.13.0.

import type { Snapshot } from "../../../../server/alerts/evaluator";

export const rtxA4000Fixture: NonNullable<Snapshot["gpu"]> = {
  available: true,
  capabilities: {
    nvidia_smi: true,
    nvidia_driver_version: "550.54.15",
    dcgm: false,
    dcgmi_version: null,
    redfish_endpoint: null,
    redfish_oem_schema: null,
    probe_duration_ms: 52,
  },
  tier1: {
    available: true,
    driver_version: "550.54.15",
    gpus: [
      {
        index: 0,
        uuid: "GPU-12f0a4b8-9c1e-4d7a-a3f2-87b6e5c4d3a2",
        name: "NVIDIA RTX A4000",
        pci_bdf: "00000000:65:00.0",
        vbios_version: "94.04.46.00.40",
        vram_total_mib: 16376, // 16 GB raw
        vram_used_mib: 412,
        temp_c: 38,
        power_draw_w: 18,
        power_limit_w: 140,
        utilization_gpu_percent: 0,
        utilization_mem_percent: 0,
        clock_graphics_mhz: 210,
        clock_sm_mhz: 210,
        clock_mem_mhz: 405,
        pstate: "P8",
        pcie_link_gen_current: 4,
        pcie_link_gen_max: 4,
        pcie_link_width_current: 16,
        pcie_link_width_max: 16,
        ecc_mode_current: false, // workstation default
        ecc_errors_corrected_volatile: 0,
        ecc_errors_corrected_aggregate: 0,
        ecc_errors_uncorrected_volatile: 0,
        ecc_errors_uncorrected_aggregate: 0,
        retired_pages_single_bit: null, // ECC off -> field absent / null
        retired_pages_double_bit: null,
        retired_pages_pending: null,
        thermal_slowdown_active: false,
        thermal_violation_total_ms: null,
        power_violation_total_ms: null,
        fan_speed_percent: 30, // active fan on RTX A4000
        nvlink_links: [], // RTX A4000 has no NVLink in this slot config
        performance_state_reasons: [],
      },
    ],
    xid_events: [],
  },
  tier2: { available: false, reason: "DCGM not active" },
  tier3: { available: false, reason: "stub in v0.13.0" },
};
