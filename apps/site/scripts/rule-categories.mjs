// Rule category map + display order for the public catalog.
//
// EXTRACTED from gen-rules.mjs on 2026-07-29 so that gen-rules and
// scripts/lint-rule-category.mjs consume the SAME data instead of the linter
// re-parsing JavaScript source text. The linter used to regex this object out of
// gen-rules.mjs and reported "all mapped" while the real generator failed, because
// a key inside a multi-line /* */ block still matched its regex. Any text-parsing
// approach has that class of hole (block comments, a "};" inside a string, a
// nested object literal, a renamed const); importing the data has none of them.
//
// Keep this file DATA ONLY: no imports, no logic. It is loaded both by the site
// prebuild and by a repo-root lint script.

// Category mapping. Originally the 8 deepening batches (B1-B8); the
// 2026-05-19 GPU rules, cross-snapshot rules, C7-C18 additions, plus the
// CMOS/DIMM/GPU-reboot/ssh-config rules brought the library to 68 rules
// across 9 categories. Every rule ID MUST be added here: an unmapped id
// falls through to "Other" (not in CATEGORY_ORDER) and is dropped from
// the corpus, so loadRules() now hard-fails the build on any unmapped id.
export const CATEGORY = {
  // Storage drive failure
  smart_failing: "Storage",
  raid_degraded: "Storage",
  nvme_wear_high: "Storage",
  nvme_critical_warning: "Storage",
  drive_smart_unreadable: "Storage",
  disk_io_errors: "Storage",
  disk_latency_high: "Storage",

  // ZFS
  zfs_pool_unhealthy: "ZFS",
  zfs_scrub_errors: "ZFS",
  zfs_slog_faulted: "ZFS",

  // Filesystem + capacity
  disk_space_high: "Filesystem",
  disk_fill_projection: "Filesystem",
  inode_high: "Filesystem",
  filesystem_readonly: "Filesystem",
  fd_exhaustion: "Filesystem",
  lvm_thinpool_metadata_high: "Filesystem",

  // Memory + CPU pressure
  ram_high: "Memory & CPU",
  swap_high: "Memory & CPU",
  oom_kills: "Memory & CPU",
  cpu_high: "Memory & CPU",
  load_high: "Memory & CPU",
  cpu_iowait_high: "Memory & CPU",
  cpu_pressure_high: "Memory & CPU",
  mem_pressure_high: "Memory & CPU",
  io_pressure_high: "Memory & CPU",

  // Network
  bond_slave_down: "Network",
  interface_errors: "Network",
  interface_saturation: "Network",
  link_speed_mismatch: "Network",
  conntrack_exhaustion: "Network",
  lacp_partner_lost: "Network",
  listen_overflow: "Network",
  accept_backlog_or_syn_flood: "Network",
  softnet_drops: "Network",
  tcp_retrans_high: "Network",

  // Hardware BMC/IPMI
  cpu_temperature_high: "Hardware (BMC/IPMI)",
  ecc_errors: "Hardware (BMC/IPMI)",
  mce_uncorrected: "Hardware (BMC/IPMI)",
  psu_redundancy_loss: "Hardware (BMC/IPMI)",
  ipmi_sel_critical: "Hardware (BMC/IPMI)",
  ipmi_sel_full: "Hardware (BMC/IPMI)",
  ipmi_monitoring_unavailable: "Hardware (BMC/IPMI)",
  ipmi_fan_failure: "Hardware (BMC/IPMI)",
  cmos_battery_low: "Hardware (BMC/IPMI)",
  memory_channels_underpopulated: "Hardware (BMC/IPMI)",

  // GPU (added 2026-05-19; consumes Crucible v0.13.0 snap.gpu)
  gpu_xid_critical: "GPU",
  gpu_uncorrected_ecc: "GPU",
  gpu_corrected_ecc_storm: "GPU",
  gpu_thermal_critical: "GPU",
  gpu_pcie_link_degraded: "GPU",
  gpu_power_cap_throttling: "GPU",
  gpu_driver_or_firmware_drift: "GPU",
  nvlink_link_down: "GPU",
  gpu_driver_unsafe_reboot: "GPU",

  // Time + services
  clock_drift: "Time & Services",
  ntp_not_synced: "Time & Services",
  systemd_service_failed: "Time & Services",
  systemd_service_oom_killed: "Time & Services",
  service_flapping: "Time & Services",
  unexpected_reboot: "Time & Services",

  // Security + patching
  ssh_root_password: "Security & Patching",
  no_firewall: "Security & Patching",
  pending_security_updates: "Security & Patching",
  kernel_vulnerabilities: "Security & Patching",
  kernel_needs_reboot: "Security & Patching",
  unattended_upgrades_disabled: "Security & Patching",
  server_unreachable: "Security & Patching",
  ssh_config_unapplied: "Security & Patching",
  os_end_of_life: "Security & Patching",
  bios_firmware_age: "Security & Patching",
};

export const CATEGORY_ORDER = [
  "Storage",
  "ZFS",
  "Filesystem",
  "Memory & CPU",
  "Network",
  "Hardware (BMC/IPMI)",
  "GPU",
  "Time & Services",
  "Security & Patching",
];
