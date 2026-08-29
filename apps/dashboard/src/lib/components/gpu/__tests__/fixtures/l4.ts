// Synthetic snap.gpu fixture for an NVIDIA L4 single-GPU host
// (matching glassmkr-val-L4 hardware: 24 GB GDDR6, 72W max TDP,
// PCIe Gen 4 x16, ECC on by default for data-center cards).
//
// Built against the Tier1Snapshot type from Crucible v0.13.0
// (src/lib/types.ts in glassmkr/crucible PR #14). Replace with
// real-host data once the NVIDIA driver is installed on
// glassmkr-val-L4 and snap.gpu actually populates.

import type { Snapshot } from "../../../../server/alerts/evaluator";

export const l4Fixture: NonNullable<Snapshot["gpu"]> = {
  available: true,
  capabilities: {
    nvidia_smi: true,
    nvidia_driver_version: "550.54.15",
    dcgm: false,
    dcgmi_version: null,
    redfish_endpoint: null,
    redfish_oem_schema: null,
    probe_duration_ms: 47,
  },
  tier1: {
    available: true,
    driver_version: "550.54.15",
    gpus: [
      {
        index: 0,
        uuid: "GPU-7e7d1b3a-4f5a-46e2-9b8d-12d2b8c4a1f0",
        name: "NVIDIA L4",
        pci_bdf: "00000000:01:00.0",
        vbios_version: "95.02.66.00.04",
        vram_total_mib: 22528, // 22 GB usable (24 GB raw)
        vram_used_mib: 856,
        temp_c: 41,
        power_draw_w: 26,
        power_limit_w: 72,
        utilization_gpu_percent: 3,
        utilization_mem_percent: 1,
        clock_graphics_mhz: 1065,
        clock_sm_mhz: 1065,
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
        fan_speed_percent: null, // L4 is passively cooled (no fan)
        nvlink_links: [], // L4 has no NVLink
        performance_state_reasons: [],
      },
    ],
    xid_events: [], // healthy host; no XIDs in window
  },
  tier2: { available: false, reason: "DCGM not active" },
  tier3: { available: false, reason: "stub in v0.13.0" },
};
