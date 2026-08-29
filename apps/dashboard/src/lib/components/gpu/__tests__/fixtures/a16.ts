// Synthetic snap.gpu fixture for an NVIDIA A16 host (one A16 card
// presents 4 GPUs to the OS; each GPU has 16 GB GDDR6; the card
// shares a single PCIe Gen 4 x16 link).
//
// Matches glassmkr-val-A16 hardware. Built against the
// Tier1Snapshot type from Crucible v0.13.0.

import type { Snapshot } from "../../../../server/alerts/evaluator";

export const a16Fixture: NonNullable<Snapshot["gpu"]> = {
  available: true,
  capabilities: {
    nvidia_smi: true,
    nvidia_driver_version: "550.54.15",
    dcgm: false,
    dcgmi_version: null,
    redfish_endpoint: null,
    redfish_oem_schema: null,
    probe_duration_ms: 64,
  },
  tier1: {
    available: true,
    driver_version: "550.54.15",
    gpus: [0, 1, 2, 3].map((i) => ({
      index: i,
      uuid: `GPU-a16-${i.toString().padStart(8, "0")}-1111-2222-333344445555`,
      name: "NVIDIA A16",
      pci_bdf: `00000000:0${i + 1}:00.0`,
      vbios_version: "94.10.55.00.05",
      vram_total_mib: 15356, // ~15 GB usable per GPU
      vram_used_mib: i === 0 ? 1024 : 256, // GPU 0 lightly loaded
      temp_c: 35 + i, // tiny per-GPU thermal variance
      power_draw_w: 18 + i * 2,
      power_limit_w: 62, // ~62W per GPU (250W / 4)
      utilization_gpu_percent: i === 0 ? 8 : 0,
      utilization_mem_percent: i === 0 ? 4 : 0,
      clock_graphics_mhz: 885,
      clock_sm_mhz: 885,
      clock_mem_mhz: 6251,
      pstate: i === 0 ? "P2" : "P8",
      pcie_link_gen_current: 4,
      pcie_link_gen_max: 4,
      pcie_link_width_current: 16,
      pcie_link_width_max: 16,
      ecc_mode_current: true, // A16 is data-center; ECC on by default
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
      fan_speed_percent: null, // chassis-cooled
      nvlink_links: [], // A16 uses internal interconnect, not NVLink lanes
      performance_state_reasons: [],
    })),
    xid_events: [],
  },
  tier2: { available: false, reason: "DCGM not active" },
  tier3: { available: false, reason: "stub in v0.13.0" },
};

// "Hot" variant for tests — GPU 1 thermally throttling, GPU 2 has
// uncorrected ECC, a few XID events in the 24h window.
export const a16HotFixture: NonNullable<Snapshot["gpu"]> = (() => {
  const base = JSON.parse(JSON.stringify(a16Fixture)) as typeof a16Fixture;
  const tier1 = base.tier1 as Extract<typeof base.tier1, { available: true }>;
  // GPU 1: hot + throttling
  tier1.gpus[1].temp_c = 92;
  tier1.gpus[1].thermal_slowdown_active = true;
  tier1.gpus[1].performance_state_reasons = ["hw_slowdown", "hw_thermal_slowdown"];
  // GPU 2: uncorrected ECC
  tier1.gpus[2].ecc_errors_uncorrected_aggregate = 3;
  tier1.gpus[2].retired_pages_double_bit = 2;
  tier1.gpus[2].retired_pages_pending = 1;
  // GPU 3: PCIe degraded
  tier1.gpus[3].pcie_link_gen_current = 3;
  // Recent XID events
  tier1.xid_events = [
    {
      timestamp_iso: new Date(Date.now() - 30 * 60_000).toISOString(),
      xid_code: 79,
      pci_bdf: "00000000:02:00.0",
      severity: "critical",
      raw_message: "NVRM: Xid (PCI:00000000:02:00): 79, GPU has fallen off the bus.",
    },
    {
      timestamp_iso: new Date(Date.now() - 90 * 60_000).toISOString(),
      xid_code: 48,
      pci_bdf: "00000000:03:00.0",
      severity: "critical",
      raw_message: "NVRM: Xid (PCI:00000000:03:00): 48, Double Bit ECC Error",
    },
  ];
  return base;
})();
