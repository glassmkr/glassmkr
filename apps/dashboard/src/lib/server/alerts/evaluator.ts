// Alert evaluation engine for bare metal server monitoring.
// 37 opinionated snapshot-driven rules in this file across OS, storage, network,
// hardware, security, and service health. The 38th customer-facing rule
// (`server_unreachable`, P1) is emitted by the watchdog at
// apps/dashboard/src/lib/server/watchdog.ts because it requires cross-snapshot
// state. Customer-facing total = 38. Canonical breakdown: see RULES_COUNT.md.
//
// Per-rule FIX workflow metadata (the display + remediation guidance
// that powers the alert card UI) lives at
// apps/dashboard/src/lib/server/alerts/rules/*.yaml - one file per
// rule, Zod-validated at server boot. See
// CC_FIX_WORKFLOW_DATA_MODEL_2026-05-14.md and the README at
// apps/dashboard/src/lib/server/alerts/rules/README.md.
//
// Adding a new rule? Add the AlertRule object below AND a matching
// YAML file under ./rules/. The coverage test in fix-workflow/
// __tests__/coverage.test.ts fails CI if either side is missing.

import { linearProjection } from "$lib/server/cross_snapshot";
import { getRuleMetadata } from "./fix-workflow/loader";
import { OWNERSHIP_REMEDIATION_NOTE } from "$lib/alerts/vendor-facing";
import { resolveFailedMembers } from "./raid-members";
import { lookupLifecycle } from "$lib/server/endoflife/cache";

// PSI resource block emitted by Crucible v0.10.4+. Per /proc/pressure
// kernel doc: avgN is the rolling % over N seconds, total is cumulative
// microseconds-stalled since boot. Defined as a top-level interface so
// the Snapshot.psi shape can reuse it for cpu / memory / io blocks.
interface PsiResource {
  avg10: number;
  avg60: number;
  avg300: number;
  total: number;
}

export interface Snapshot {
  /** Agent version string as sent on the ingest payload (declared in
   *  snapshot-schema.ts). Rules use it ONLY to tell whether a field they depend on
   *  can be trusted on this agent; never to gate a hardware fact. */
  collector_version?: string;
  system: { hostname: string; ip: string; os: string; os_id?: string; os_id_like?: string; os_version_id?: string; kernel: string; uptime_seconds: number };
  cpu: { user_percent: number; system_percent: number; iowait_percent: number; idle_percent: number; load_1m: number; load_5m: number; load_15m: number; cores?: Array<{ core: number; user_percent: number; system_percent: number; iowait_percent: number; idle_percent: number }> };
  memory: { total_mb: number; used_mb: number; available_mb: number; free_mb?: number; swap_total_mb: number; swap_used_mb: number };
  disks: Array<{ device: string; mount: string; total_gb: number; used_gb: number; available_gb: number; percent_used: number; io_read_mb_s?: number; io_write_mb_s?: number; latency_p99_ms?: number; fstype?: string; options?: string; options_unreliable?: true; inodes_total?: number; inodes_used?: number; inodes_free?: number }>;
  smart: Array<{ device: string; model: string; transport?: string; backing_device?: string; serial?: string; firmware?: string; health: string; temperature_c?: number; percentage_used?: number; reallocated_sectors?: number; pending_sectors?: number; power_on_hours?: number; critical_warning_raw?: number; critical_warning_decoded?: { available_spare_low: boolean; temperature_threshold: boolean; reliability_degraded: boolean; read_only: boolean; volatile_memory_backup_failed: boolean; persistent_memory_readonly: boolean }; nvme_available_spare?: number; nvme_available_spare_threshold?: number; reported_uncorrectable?: number; command_timeout?: number; high_fly_writes?: number; spin_retries?: number; reallocation_events?: number; offline_uncorrectable?: number; udma_crc_errors?: number; media_errors?: number; num_err_log_entries?: number; self_test?: { last_type?: string; last_status: string; last_passed?: boolean; last_lifetime_hours?: number; last_failed_lba?: number; last_failed_lifetime_hours?: number; error_count_total?: number } }>;
  // Fixed disks present in /sys/block whose SMART could not be read (Crucible
  // 0.14.4+). Read by drive_smart_unreadable to surface the monitoring blind
  // spot. Omitted by older agents and hosts with fully-readable SMART.
  smart_unreadable?: Array<{ device: string; reason: string }>;
  network: Array<{ interface: string; speed_mbps: number; rx_bytes_sec: number; tx_bytes_sec: number; rx_errors: number; tx_errors: number; rx_drops: number; tx_drops: number; rx_packets?: number; tx_packets?: number; rx_crc_errors?: number; rx_frame_errors?: number; rx_length_errors?: number; tx_carrier_errors?: number; operstate?: string; bond_master?: string; is_bond_master?: boolean }>;
  raid: Array<{ device: string; level: string; status: string; degraded: boolean; disks: string[]; failed_disks: string[] }>;
  /** Chassis power provenance (Crucible 0.15.0+). FACTS ONLY: `last_power_event` is a
   *  decoded BIT SET in which a healthy host can legitimately assert `ac_failed`, and
   *  `restart_cause` names a management PATH, not an actor. No rule may render either
   *  as a cause without platform calibration and corroboration. */
  chassis?: {
    last_power_event: { raw: string; present: boolean; ac_failed: boolean; power_overload: boolean; power_interlock: boolean; power_fault: boolean; powered_on_by_command: boolean; unrecognised_tokens?: string[] } | null;
    restart_cause: { raw: string; code: number | null; label: string } | null;
    power_restore_policy: string | null;
    power_overload_now: boolean | null;
    main_power_fault_now: boolean | null;
    power_control_fault_now: boolean | null;
  };
  ipmi: { available: boolean; /** One-shot IPMI capability probe (Crucible 0.12.0+); explains WHY available is false. `reason` is a loose string, not a union of the five reasons Crucible ships today, so a newer agent's new reason type-checks here and is handled at runtime by ipmi_monitoring_unavailable. Optional: absent on pre-detection agents. */ detection?: { available: boolean; method?: string; ipmitool_version?: string | null; reason?: string; detail?: string; ipmitool_below_cve_floor?: boolean }; /** Crucible 0.14.9+: `/dev/ipmi*` node the kernel created, or null. Re-checked every snapshot (unlike `detection`, which is one-shot at agent start). Non-null = positive evidence a BMC exists; null = UNDETERMINED, never "no BMC". */ bmc_device_node?: string | null; /** Crucible 0.14.9+: outcome of THIS snapshot's collection. `failed` alongside a non-null bmc_device_node is the "BMC present but not answering" signal. */ probe?: { status: string; detail?: string }; bmc_vendor?: "dell" | "hpe" | "supermicro" | "lenovo" | "cisco" | "openbmc" | "unknown"; sensors: Array<{ name: string; value: number | string; unit: string; status: string; upper_critical?: number; type?: string }>; ecc_errors: { correctable: number; uncorrectable: number } | null; ecc_errors_from_sel?: { correctable: number; uncorrectable: number; newest_event_timestamp: string | null }; psu_redundancy_state?: "fully_redundant" | "redundancy_lost" | "redundancy_degraded" | "unknown"; sel_entries_count: number | null; sel_events_recent?: Array<{ id: number; timestamp: string; sensor: string; sensor_type: string; event: string; direction: string; severity: string; parser_quality?: "fleet-tested" | "stub" | "unknown" }>; fans?: Array<{ name: string; rpm: number; status: string }> };
  os_alerts: { oom_kills_recent: number; zombie_processes: number; time_drift_ms: number };
  security?: {
    ssh: { permitRootLogin: string; passwordAuthentication: string; rootPasswordExposed: boolean; configApplied?: boolean; configMtime?: number | null; configLoadedAt?: number | null } | null;
    firewall: { active: boolean; source: string; details: string };
    pending_updates: { distro: string; pendingCount: number; available: boolean } | null;
    kernel_vulns: Array<{ name: string; status: string; mitigated: boolean }>;
    kernel_reboot: { running: string; installed: string; needsReboot: boolean } | null;
    auto_updates: { configured: boolean; mechanism: string; details: string };
  };
  // OS extended-support enrollment (Crucible 0.13.24+, support-status
  // collector). Read by os_end_of_life to distinguish a past-EOL host that is
  // still covered (ESM/EUS) from one that is genuinely unsupported.
  support_status?: {
    source: string;
    extended_support_active: boolean | null;
    details: string;
    attached?: boolean;
    esm_infra?: boolean;
    esm_apps?: boolean;
    eus?: boolean;
  };
  zfs?: {
    pools: Array<{
      name: string;
      state: string;
      errors_text: string;
      scrub_errors?: number;
      scrub_repaired?: string;
      last_scrub_date?: string;
      scrub_never_run?: boolean;
      // C6 vdev fields shipped by Crucible v0.10.4+. All optional;
      // pre-0.10.4 agents omit them. zfs_pool_unhealthy falls back
      // to uniform DEGRADED-pages-critical on absent vdev metadata.
      // zfs_slog_faulted already consumes slog_vdevs via (pool as any)
      // access; this declaration types the same field properly while
      // keeping that rule's call shape unchanged.
      vdevs?: Array<{
        name: string;
        state: string;
        // Redundancy class of this top-level vdev. Values produced by
        // Crucible C6: "mirror_2way" | "mirror_3way" | "mirror_4way+"
        // | "raidz1" | "raidz2" | "raidz3" | "single" | "stripe".
        // Untyped here (string) so a new class from Crucible doesn't
        // break compile; severity matrix narrows known values.
        redundancy_class?: string;
        // True when a hot-spare auto-replacement is in progress; ZFS
        // emits "spare" entries during resilver. Demotes raidz2
        // DEGRADED from P1 -> P2 per the matrix.
        spare_in_progress?: boolean;
      }>;
      slog_vdevs?: Array<{ name: string; state: string }>;
      l2arc_vdevs?: Array<{ name: string; state: string }>;
    }>;
  };
  io_errors?: { count: number; devices: string[] };
  io_latency?: Array<{ device: string; avg_read_latency_ms: number | null; avg_write_latency_ms: number | null; read_iops: number; write_iops: number }>;
  conntrack?: {
    available: boolean;
    count: number;
    max: number;
    percent: number;
    // C9 (Crucible v0.11.0+) additions; all optional.
    insert_failed_total?: number;
    drop_total?: number;
    insert_failed_rate_per_sec?: number | null;
    drop_rate_per_sec?: number | null;
  };
  systemd?: {
    failed_units: string[];
    failed_count: number;
    /** Per-unit last 5 journal lines, populated by Crucible 0.9.2+
     *  when a failed unit is detected. Optional because pre-0.9.2
     *  agents omit it; the evaluator reads it defensively and
     *  surfaces "(journal excerpt not available - upgrade Crucible
     *  to 0.9.2+)" when missing. Codex experiment 2026-05-12. */
    journal_excerpts?: Record<string, string[]>;
    /** C12 (Crucible v0.12.0+, 2026-05-19): structured per-failed-
     *  unit details. Keys match failed_units. Optional; absent on
     *  pre-0.12.0 agents. Dashboard's systemd_service_failed TUNE
     *  + service_flapping + systemd_service_oom_killed rules
     *  consume these fields. */
    failed_unit_details?: Record<string, {
      name: string;
      result: "success" | "protocol" | "timeout" | "exit-code" | "signal" | "core-dump" | "watchdog" | "start-limit-hit" | "resources" | "oom-kill" | "unknown";
      active_state: string;
      sub_state: string;
      n_restarts: number;
    }>;
  };
  ntp?: { synced: boolean; offset_seconds: number; source: string; daemon_running: boolean; daemon_name?: string };
  file_descriptors?: { allocated: number; free: number; max: number; percent: number };
  /** Set to true by Crucible on the first snapshot after a reboot that
   *  was marked with `crucible-agent mark-reboot` / `reboot`. Tells the
   *  `unexpected_reboot` rule to stay quiet. Single-use: the agent
   *  only emits this on the first snapshot post-boot. */
  expected_reboot?: boolean;
  expected_reboot_reason?: string;

  // C1-C6 fields (Crucible v0.10.4+). All optional; capability gates in
  // the evaluator key off field presence so older agents and hosts
  // lacking the kernel/CLI surface degrade gracefully.
  ecc_edac?: {
    edac_corrected_total: number;
    edac_uncorrected_total: number;
    dimms: Array<{ label: string; location: string; size_mb: number | null; ce_count: number; ue_count: number }>;
  };
  /** DIMM population topology from SMBIOS Type 17 (Crucible 0.13.19+).
   *  Collected facts only; the under-population judgment lives in the
   *  memory_channels_underpopulated rule. Absent on VMs / older agents /
   *  hosts without dmidecode. */
  memory_topology?: {
    source: string;
    total_slots: number;
    populated_slots: number;
    available_channels: number;
    populated_channels: number;
    downclocked: boolean;
    mixed_parts: boolean;
    dimms: Array<{
      locator: string; bank_locator: string | null; socket: number | null;
      channel: string | null; slot: number | null; populated: boolean;
      size_mb: number | null; rank: number | null; type: string | null;
      speed_mts: number | null; configured_mts: number | null;
      manufacturer: string | null; part_number: string | null;
    }>;
  };
  psi?: {
    cpu?: { some: PsiResource; full?: PsiResource };
    memory?: { some: PsiResource; full?: PsiResource };
    io?: { some: PsiResource; full?: PsiResource };
  };
  vmstat?: {
    pswpin_total: number;
    pswpout_total: number;
    pswpin_rate: number | null;
    pswpout_rate: number | null;
  };
  reboot_evidence?: {
    pstore_present: boolean;
    pstore_record_count: number;
    vmcore_present: boolean;
    wtmp_reboot_record: string | null;
    prior_shutdown_clean: boolean;
  };
  /** Boot-config integrity (Crucible 1.2.0+, val-rocky postmortem). The
   *  collector cross-checks every boot target's root= filesystem reference
   *  against the filesystems that actually exist and precomputes the summary
   *  flags below; boot_config_broken / boot_config_drift read them directly.
   *  Absent on older agents and available:false on unprivileged hosts, so both
   *  rules degrade to silence. Loose booleans/strings so a newer agent cannot
   *  break ingest. */
  boot_config?: {
    available: boolean;
    error?: string;
    mounted_root: { source: string; uuid: string | null; label: string | null } | null;
    cmdline_source: { path: string; root_spec: string | null; resolvable: boolean | null; matches_mounted: boolean | null } | null;
    entries: Array<{ source: string; title: string; kernel: string | null; root_spec: string | null; resolvable: boolean | null; matches_mounted: boolean | null; is_default: boolean }>;
    default_entry_bootable: boolean | null;
    default_entry_wrong_fs: boolean | null;
    unbootable_entry_count: number;
    source_regressed: boolean | null;
  };
  hardware_raid?: {
    controllers: Array<{
      vendor: "dell" | "hpe" | "lsi" | "adaptec";
      controller_id: string;
      state: string;
      degraded_disks: number | null;
      raw_summary: string | null;
    }>;
  };

  // C7-C10 fields (Crucible v0.11.0+). All optional; capability gates
  // in this evaluator key off field presence. Per CC_SPEC_FORGE_C7_C10
  // _ACTIVATION_2026-05-19.md.
  process_fd?: {
    available: boolean;
    reason?: string;
    top_consumers: Array<{
      pid: number;
      comm: string;
      fd_count: number;
      rlimit_nofile_soft: number;
      rlimit_nofile_hard: number;
      percent_of_soft_limit: number;
    }>;
    total_processes_scanned: number;
    highest_percent_of_limit: number | null;
  };
  bonding?: {
    available: boolean;
    reason?: string;
    bonds: Array<{
      name: string;
      mode: string;
      is_lacp: boolean;
      lacp_rate: string | null;
      slaves: Array<{
        name: string;
        mii_status: string;
        link_failure_count: number;
        permanent_hw_addr: string;
        aggregator_id: number | null;
        partner_churn_state: string | null;
        partner_lacp_port_state: number | null;
        partner_lacp_synchronized: boolean | null;
      }>;
      configured_port_count: number;
      active_aggregator: {
        id: number;
        number_of_ports: number;
        actor_key: number | null;
        partner_key: number | null;
        partner_mac_address: string | null;
      } | null;
    }>;
  };
  tcp_stats?: {
    available: boolean;
    reason?: string;
    out_segs_total?: number;
    retrans_segs_total?: number;
    in_segs_total?: number;
    retrans_ratio?: number | null;
    retrans_rate_per_sec?: number | null;
    listen_overflows_total?: number;
    listen_drops_total?: number;
    listen_overflows_rate_per_sec?: number | null;
    listen_drops_rate_per_sec?: number | null;
  };

  // C11-C18 fields (Crucible v0.12.0+). Per CC_SPEC_FORGE_C11_C18_
  // ACTIVATION_2026-05-19.md. All optional; capability gates in this
  // evaluator key off field presence.
  lvm?: {
    available: boolean;
    reason?: string;
    thin_pools: Array<{
      lv_name: string;
      vg_name: string;
      data_percent: number;
      metadata_percent: number;
    }>;
  };
  ethtool?: {
    available: boolean;
    reason?: string;
    interfaces: Array<{
      iface: string;
      advertised_auto_negotiation: boolean | null;
      advertised_link_modes: string[];
    }>;
  };
  softnet?: {
    available: boolean;
    reason?: string;
    total_dropped_cumulative: number;
    per_cpu_dropped: number[];
    total_dropped_rate_per_sec: number | null;
  };
  cve?: {
    available: boolean;
    reason?: string;
    distro: string;
    kernel_cves_pending: Array<{
      cve_id: string;
      severity: "critical" | "important" | "moderate" | "low" | "unknown";
      package_name: string;
      fixed_version?: string;
    }>;
    total_critical_pending: number;
    total_important_pending: number;
    parser_quality: "fleet-tested" | "stub";
  };
  dmesg_events?: {
    available: boolean;
    reason?: string;
    events: Array<{
      timestamp_iso: string;
      event_type: "scsi_sense" | "nvme_reset" | "ext4_remount_readonly";
      severity: "critical" | "warning" | "informational";
      details: Record<string, string | number | boolean>;
      raw_line: string;
    }>;
    events_by_type: Record<string, number>;
    window_seconds: number;
  };

  // C19 GPU collection (Crucible v0.13.0+). Per CC_SPEC_GPU_RULES_
  // 2026-05-19.md. All optional; capability gates in this evaluator
  // key off field presence. Non-NVIDIA hosts see snap.gpu.available
  // === false in <10ms; zero false positives, zero errors.
  gpu?: {
    available: boolean;
    reason?: string;
    capabilities: {
      nvidia_smi: boolean;
      nvidia_driver_version: string | null;
      dcgm: boolean;
      dcgmi_version: string | null;
      redfish_endpoint: string | null;
      redfish_oem_schema: string | null;
      probe_duration_ms: number;
    };
    // Present even when available === false (the dangerous nouveau case is
    // exactly when nvidia-smi is dead). Drives gpu_driver_unsafe_reboot.
    driver_resilience?: {
      nvidia_pci_present: boolean;
      nvidia_module_loaded: boolean;
      nouveau_module_loaded: boolean;
      nouveau_blacklisted: boolean;
    };
    tier1?:
      | {
          available: true;
          gpus: Array<{
            index: number;
            uuid: string;
            name: string;
            pci_bdf: string;
            vbios_version: string;
            vram_total_mib: number;
            vram_used_mib: number;
            temp_c: number;
            power_draw_w: number;
            power_limit_w: number;
            utilization_gpu_percent: number;
            utilization_mem_percent: number;
            clock_graphics_mhz: number;
            clock_sm_mhz: number;
            clock_mem_mhz: number;
            pstate: string;
            pcie_link_gen_current: number;
            pcie_link_gen_max: number;
            pcie_link_width_current: number;
            pcie_link_width_max: number;
            pcie_slot_max_width?: number | null;
            ecc_mode_current: boolean;
            ecc_errors_corrected_volatile: number;
            ecc_errors_corrected_aggregate: number;
            ecc_errors_uncorrected_volatile: number;
            ecc_errors_uncorrected_aggregate: number;
            retired_pages_single_bit: number | null;
            retired_pages_double_bit: number | null;
            retired_pages_pending: number | null;
            thermal_slowdown_active: boolean;
            thermal_violation_total_ms: number | null;
            power_violation_total_ms: number | null;
            fan_speed_percent: number | null;
            nvlink_links: Array<{
              link_id: number;
              state: "up" | "down" | "inactive";
              speed_gbps: number;
            }>;
            performance_state_reasons: string[];
          }>;
          xid_events: Array<{
            timestamp_iso: string;
            xid_code: number;
            pci_bdf: string;
            severity: "critical" | "warning" | "info";
            raw_message: string;
          }>;
          driver_version: string;
        }
      | { available: false; reason: string };
    tier2?:
      | {
          available: true;
          parser_quality: "stub" | "fleet-tested";
          nvswitch_status: Array<{
            uuid: string;
            port_count_total: number;
            port_count_active: number;
            port_count_faulted: number;
            faulted_ports: number[];
          }>;
          nvlink_detailed: Array<{
            link_id: number;
            state: string;
            speed_gbps: number;
            remote_gpu_uuid: string | null;
            remote_nvswitch_uuid: string | null;
            replay_errors: number;
            recovery_errors: number;
            crc_errors: number;
            flit_crc_errors: number;
          }>;
          retired_pages_detail: Array<{
            gpu_uuid: string;
            address: string;
            cause: "single_bit_ecc" | "double_bit_ecc";
            retired_at_iso: string;
          }>;
          thermal_violation_time_series_ms: number;
          power_violation_time_series_ms: number;
          health_summary_raw: string;
        }
      | { available: false; reason: string };
    tier3?:
      | { available: true; parser_quality: "stub" | "fleet-tested"; oem_schema: string }
      | { available: false; reason: string };
  };

  /** Hwmon-derived CPU thermal data (Crucible 0.8.0+). Populated from
   *  /sys/class/hwmon/. Preferred over IPMI for `cpu_temperature_high`
   *  rule because hwmon is more accurate, sensor naming is standardised
   *  by the CPU vendor, and it works on hosts without a BMC (Pi,
   *  hypervisors, containers). IPMI is still used as a fallback. */
  thermal?: {
    available?: boolean;
    /** Description of the source path used by the agent, e.g.
     *  "hwmon coretemp Package id 0" or "thermal_zone0 x86_pkg_temp". */
    source?: string;
    /** Highest CPU reading the agent observed across all chips, in °C.
     *  Null when the agent collected hwmon data but no chip exposed a
     *  recognised CPU reading. */
    max_cpu_celsius?: number | null;
    /** Per-chip CPU readings the agent classified as CPU temperature.
     *  `celsius` is nullable: agent emits one reading per hwmon chip
     *  even when the underlying sensor can't produce a current value. */
    cpu_readings?: Array<{ chip?: string; label?: string; celsius: number | null }>;
    /** Per-chip non-CPU readings (motherboard, ambient, etc.). Same
     *  nullable-celsius semantics as cpu_readings. */
    other_readings?: Array<{ chip?: string; label?: string; celsius: number | null }>;
  };

  /** DMI / SMBIOS hardware identification (Crucible 0.8.0+). Surfaced
   *  on the dashboard tile + server detail page. raw_vendor +
   *  product_name are denormalised onto servers in PG (migration 012)
   *  so the list endpoint can return them without an n+1 ClickHouse
   *  query. */
  dmi?: {
    available: boolean;
    vendor: string;
    raw_vendor: string | null;
    product_name: string | null;
    bios_version: string | null;
    bios_date: string | null;
    is_virtual: boolean;
  };
}

export interface ServerConfig {
  /**
   * Legacy ram_high threshold (used% basis). Pre-2026-05-18 default 90.
   * Now only consumed by the ram_high evaluator's fallback path when
   * MemAvailable is unavailable on the snapshot (very rare; pre-3.14
   * kernels only). Kept for backward-compat with existing customer
   * overrides.
   */
  ram_threshold_percent?: number;
  /**
   * Primary ram_high threshold (2026-05-18 audit, MemAvailable basis).
   * Fires when `available_mb / total_mb * 100 < this_value`. Default 5.
   * Critical band hard-coded at 2% (no override). MemAvailable accounts
   * for reclaimable cache, so this is the honest pressure signal.
   */
  ram_available_threshold_percent?: number;
  swap_alert?: boolean;
  disk_threshold_percent?: number;
  iowait_threshold_percent?: number;
  /**
   * Minimum 1-minute load average below which cpu_iowait_high is suppressed.
   * iowait% is meaningless on a near-idle box: trivial background I/O becomes a
   * huge percentage of near-zero CPU activity (round 5 idle-box artifact).
   * Default 1.0.
   */
  iowait_min_load_1m?: number;
  nvme_wear_percent?: number;
  /**
   * Lower "plan replacement" watch tier for drive endurance (SSD/NVMe), in
   * percent-used. A drive at or above this but below nvme_wear_percent fires an
   * info-level watch (dashboard-visible, non-paging) so a well-worn drive is
   * surfaced before it crosses the warning line. Default 75.
   */
  ssd_wear_watch_percent?: number;
  /**
   * Minimum implied out-segment rate (segments/sec) required before a TCP
   * retransmit RATIO is trusted. A ratio is small-denominator noise on a quiet
   * host; below this the retransmit rate is not throughput-relevant. Default
   * 500 (~6 Mbit/s). Raised from an original 50 after the production host (an
   * idle services box baselining ~107 out-segs/sec) kept firing quiet-moment
   * bursts. Tunable per-host for a genuinely-low-traffic-but-critical box.
   */
  tcp_retrans_min_out_segs_rate?: number;
  /**
   * Per-device-class disk_latency_high thresholds (2026-05-18 audit).
   * Each field is the WARNING threshold for that class in ms; critical
   * is 5x. Device class is inferred from device name (nvme*) or model
   * (heuristic; falls back to HDD if uncertain).
   */
  disk_latency_nvme_ms?: number;
  disk_latency_ssd_ms?: number;
  disk_latency_hdd_ms?: number;
  /**
   * Busy-direction IOPS (per SECOND) at or above which high disk latency is
   * treated as I/O saturation (informational) rather than a failing drive. High
   * latency under heavy throughput is a load artifact (e.g. Docker-on-loopback
   * over RAID), not hardware decline. Crucible reports read_iops/write_iops as
   * per-interval counts; disk_latency_high divides by the collection interval to
   * get a true per-second rate, so this bar is interval-robust. Default 500/s.
   */
  disk_latency_saturation_iops?: number;
  /**
   * The host's effective collection interval in seconds, threaded in by the
   * ingest handler (server config override, else measured cadence, else 300).
   * Used to convert Crucible's per-interval operation counts into per-second
   * rates (see disk_latency_high). Absent = assume the 300s default.
   */
  collection_interval_seconds?: number;
  /**
   * Minimum sustained PSI io.full avg60 (percent) required for io_pressure_high.
   * Gates out brief 10-second avg10 bursts (round 5 Docker-on-loopback false
   * alarm: avg10 spikes while avg60 stays low). Default 10.
   */
  io_pressure_avg60_percent?: number;
  cpu_temp_warning_c?: number;
  cpu_temp_critical_c?: number;
  interface_utilization_percent?: number;
  // Rate-based ECC threshold (Phase 7 P1, glassmkr#24). Fires when
  // more than this many correctable ECC errors are observed in
  // ecc_rate_window_hours (default 24). Default 10 errors per
  // window. Uncorrectable ECC has no rate gate - critical fires at
  // >= 1 always (zero-tolerance, replace DIMM).
  ecc_correctable_rate_warning?: number;
  // Rolling window in hours for the rate-based ECC rule. Default 24.
  // Operators can widen (168 = 7d) for chronically noisy hosts or
  // narrow (1) for sensitive workloads. Counter-reset detection
  // applies the same way regardless of window length.
  ecc_rate_window_hours?: number;
  // Legacy override (pre-glassmkr#24). The field used to set a
  // cumulative-count threshold. Migration 014 renames every existing
  // override to ecc_correctable_rate_warning. The field is kept here
  // as a read-only backward-compat fallback so a stale row never
  // throws TS and a customer who somehow still has it set continues
  // to suppress correctly (their old value applies as the rate
  // threshold; usually 100, which is far above realistic per-day
  // rates so it effectively still suppresses).
  ecc_correctable_warning?: number;
  // Rolling time window for `ipmi_sel_critical` rule (Codex
  // experiment 2026-05-12 finding). Default 30 days. Customer can
  // widen (365 = 1y, useful when investigating a long incident) or
  // narrow (1 = 24h, useful for high-churn fleets). Events outside
  // the window are kept in evidence as `events_outside_window` so
  // the dashboard can show "+N older event(s) hidden" without
  // surprising the customer.
  ipmi_sel_critical_window_days?: number;
  muted_rules?: string[];
}

/**
 * Best-effort parse of an IPMI SEL timestamp into a Unix-ms number.
 *
 * Returns null when the string can't be parsed. The intent is fail-
 * open: a SEL event with a non-parseable timestamp is included in
 * any time-window evaluation (treated as "could be recent") so we
 * don't silently suppress real signal because Crucible's emission
 * shape diverges from ISO-8601.
 *
 * Empirically observed shapes from Crucible 0.9.1:
 *   - "24-11-14T16:16:02 UTCZ"   (broken: 2-digit year + trailing UTCZ)
 *   - "2026-05-12T21:39:08Z"     (correct ISO once Crucible fix ships)
 *   - "11/14/24 16:16:02"        (raw ipmitool MM/DD/YY)
 *
 * The shape-normalisation belongs at Crucible (filed for PR B); this
 * helper is the receive-side tolerance.
 */
function parseSelTimestamp(raw: string | undefined | null): number | null {
  if (!raw) return null;
  // Standard ISO first.
  const isoTry = Date.parse(raw);
  if (!Number.isNaN(isoTry)) return isoTry;
  // YY-MM-DDTHH:MM:SS UTCZ → expand to 4-digit year, drop trailing Z.
  const ymd = raw.match(/^(\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\s*UTC?Z?$/);
  if (ymd) {
    const [, yy, mm, dd, hh, mi, ss] = ymd;
    const yyyy = Number(yy) < 70 ? `20${yy}` : `19${yy}`;
    const t = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`);
    if (!Number.isNaN(t)) return t;
  }
  // MM/DD/YY HH:MM:SS → US-style ipmitool default.
  const mdy = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (mdy) {
    const [, mm, dd, yy, hh, mi, ss] = mdy;
    const yyyy = Number(yy) < 70 ? `20${yy}` : `19${yy}`;
    const t = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export interface AlertResult {
  type: string;
  // "info" added 2026-05-18 (PR #154 / dogfood-loop iteration 4): for
  // rules that fire when the kernel software mitigation is engaged and
  // the only customer-actionable remediation is "wait for upstream
  // microcode" (i.e. not customer-actionable). The notification
  // dispatcher's getPriority() defaults P3 for unknown severities;
  // "info" sits naturally below "warning" without paging behaviour
  // changes elsewhere.
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  evidence: Record<string, unknown>;
  recommendation: string;
}

/**
 * Per-rule context populated by the ingest path's pre-pass. Only
 * supplied to rules that declare a `cross_snapshot` block in their
 * YAML metadata; everyone else sees `undefined`.
 *
 * See CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §2.3.
 */
export interface CrossSnapshotPayload {
  snapshots: Array<{ timestamp: number; [column: string]: unknown }>;
  correlation: {
    matched: string[];
    oldest_first_seen_ms: number | null;
  } | null;
}

export interface EvaluatorContext {
  cross_snapshot?: CrossSnapshotPayload;
}

interface AlertRule {
  type: string;
  evaluate(
    snap: Snapshot,
    config: ServerConfig,
    ctx?: EvaluatorContext,
  ): AlertResult[];
  /** Uptime (seconds) below which this rule's alerts are suppressed
   *  with status `suppressed_boot_grace`. Lets transient post-boot
   *  conditions (bond flap, clock not yet synced) resolve themselves
   *  before paging. Missing / 0 means no grace (fire immediately). */
  boot_grace_seconds?: number;
}

/** Record of a rule that matched but was suppressed rather than firing.
 *  Written to alert_history for audit so "why did this not fire" has
 *  a paper trail. */
export interface SuppressedAlert {
  type: string;
  reason: "boot_grace" | "planned_reboot";
  uptime_at_evaluation: number;
  grace_seconds?: number;
  planned_reboot_reason?: string;
  title: string;
  message: string;
  severity: AlertResult["severity"];
  evidence: Record<string, unknown>;
}

// Human-friendly unit formatting (base-1024, matches df -h / free -h)
function fmtMB(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function fmtGB(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  return `${gb.toFixed(1)} GB`;
}

// Whether an IPMI sensor entry is a temperature reading. Prefers BMC-reported
// `type`; falls back to the unit string because some BMCs do not expose type
// cleanly. Defensive against case differences and the SI "degrees C" spelling.
function isTemperatureSensor(s: { type?: string; unit?: string }): boolean {
  const t = (s.type ?? "").toLowerCase();
  if (t === "temperature" || t === "temp") return true;
  const u = (s.unit ?? "").trim();
  return (
    u === "C" ||
    u === "°C" ||
    /^degrees?\s*c$/i.test(u) ||
    /^deg(\s|ree)?\s*c$/i.test(u)
  );
}

// Coerce a possibly-undefined / null / NaN / non-finite count to a
// non-negative integer. Used by ecc_errors to make max(named, sel)
// safe under partial schemas (older agents missing ecc_errors_from_sel)
// or malformed values.
function sanitizeCount(v: number | undefined | null): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return v;
}

// Path attribution for ecc_errors evidence. Tells the dashboard which
// counter contributed to the alert: only the named-sensor path, only
// the SEL-derived path, both, or neither (no alert fires).
function derivePath(namedTotal: number, selTotal: number): "named" | "sel" | "both" | "none" {
  if (namedTotal > 0 && selTotal > 0) return "both";
  if (namedTotal > 0) return "named";
  if (selTotal > 0) return "sel";
  return "none";
}

// Build diagnostic fix commands for interface errors/drops, with bond-aware
// slave inspection. Shared by the hardware-error and drop-threshold branches.
function buildIfaceFixCmds(ifName: string, isBond: boolean, network: Snapshot["network"]): string[] {
  const cmds = [
    "# Check all interface counters",
    "ip -s link show",
    "",
    `# Check driver-level stats for ${ifName}`,
    `ethtool -S ${ifName} | egrep -i "err|drop|crc|miss|fault|timeout|reset"`,
  ];
  if (isBond) {
    const physIfaces = network
      .filter((i) => i.interface !== ifName && !i.interface.startsWith("bond") && !i.interface.startsWith("br") && !i.interface.startsWith("lo"))
      .map((i) => i.interface);
    cmds.push("", "# Bond slave health", `cat /proc/net/bonding/${ifName}`);
    if (physIfaces.length > 0) {
      cmds.push("", "# Check each slave interface for hardware errors",
        ...physIfaces.map((s) => `ethtool -S ${s} | egrep -i "err|drop|crc|miss|fault|timeout|reset"`));
    }
  }
  cmds.push(
    "", "# Check if drops are firewall blocks (common on internet-facing servers)",
    'dmesg -T | grep -i "UFW BLOCK\\|DROP\\|REJECT" | tail -20',
    "", `# Check ring buffer size`, `ethtool -g ${ifName}`,
    "", "# Check kernel messages for link events",
    'dmesg -T | egrep -i "bond|link up|link down|reset|timeout|error" | tail -20',
  );
  return cmds;
}

/**
 * Short human-readable description for an NVIDIA XID code. C19
 * activation 2026-05-19. Covers the most-common critical codes;
 * unknowns fall back to a generic phrase. Source: NVIDIA XID Errors
 * documentation, refreshed 2026-05-19.
 */
function xidShortDescription(code: number): string {
  const table: Record<number, string> = {
    13: "Graphics Engine exception",
    31: "GPU memory page fault",
    43: "GPU stopped processing",
    45: "Preemptive cleanup",
    48: "Double Bit ECC error",
    62: "Internal microcontroller halt",
    63: "ECC page retirement recording",
    64: "ECC page retirement recording failure",
    74: "NVLink error",
    79: "GPU has fallen off the bus",
    92: "High single-bit ECC error rate",
    94: "Contained ECC error",
    95: "Uncontained ECC error",
    119: "GSP RPC timeout",
    120: "GSP RPC timeout",
  };
  return table[code] ?? "hardware fault (consult NVIDIA XID reference)";
}

/**
 * Per-XID remediation guidance. Covers the highest-frequency critical
 * codes operators see in practice; unknowns get a generic instruction.
 * C19 activation 2026-05-19.
 */
function gpuXidRecommendation(code: number): string {
  if (code === 79) {
    return "XID 79 (GPU fell off the bus) is the most severe XID. Reseat the GPU first (power down, remove, reseat in slot + reconnect power cables); if it recurs after a clean reseat plus power-cycle, schedule replacement. Capture `nvidia-bug-report.sh` output before reseating for vendor warranty/RMA.";
  }
  if (code === 48 || code === 95) {
    return "Double-bit / uncontained ECC error: VRAM has failed beyond ECC recovery. Plan immediate GPU replacement; the same memory location will keep faulting. Capture vbios + serial for RMA. Pair with gpu_uncorrected_ecc evidence on the same host.";
  }
  if (code === 94) {
    return "Contained ECC error: kernel was able to contain the fault but the affected memory region is now blocked. Sustained contained errors are an end-of-life signal; plan replacement before they escalate to uncontained.";
  }
  if (code === 92) {
    return "Single-bit ECC error rate high: precursor to DBE. Monitor closely; if the rate continues climbing, schedule preventive replacement before uncorrected ECC fires.";
  }
  if (code === 74) {
    return "NVLink error: cross-reference with nvlink_link_down for affected links. Inspect cabling on NVLink-bridged systems or NVSwitch ports on HGX systems.";
  }
  if (code === 119 || code === 120) {
    return "GSP RPC timeout: the GPU's System Processor stopped responding to driver RPCs. Often a driver/firmware version mismatch. Verify nvidia-smi reports a sane vbios + driver version; if mismatched, reflash to the fleet baseline.";
  }
  return "Per NVIDIA's XID error documentation, critical XIDs require investigation. Capture `nvidia-bug-report.sh` for vendor escalation; cross-reference with dmesg for surrounding context.";
}

/**
 * Parse ethtool advertised-link-mode tokens (e.g. "10000baseT/Full",
 * "1000baseT/Full", "100baseT/Half") into Mbps and return the
 * highest. Returns null when no token parses (defensive on novel
 * mode shapes; the rule simply skips a mismatch emission rather
 * than fire on garbled input). C15 activation (2026-05-19).
 */
function highestAdvertisedSpeedMbps(modes: string[]): number | null {
  let max = 0;
  for (const m of modes) {
    const mat = m.match(/^(\d+)base/i);
    if (!mat) continue;
    const n = Number(mat[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max > 0 ? max : null;
}

// ZFS vdev classification per CC_SPEC_FORGE_C1_C6_DEFERRED_TUNES §2.2.
// Returns null when the vdev contributes no emission (ONLINE), or
// when state is not recognised (defensive - ZFS could grow new
// states; we degrade quietly rather than misclassify).
type ZfsVdevTyped = NonNullable<NonNullable<Snapshot["zfs"]>["pools"][number]["vdevs"]>[number];

function classifyZfsVdev(
  vdev: ZfsVdevTyped,
): { severity: AlertResult["severity"]; reason: string } | null {
  if (vdev.state === "ONLINE") return null;
  if (vdev.state === "OFFLINE") {
    return { severity: "info", reason: "vdev administratively offline" };
  }
  if (vdev.state === "FAULTED") {
    return { severity: "critical", reason: "top-level vdev faulted; pool inaccessible" };
  }
  if (vdev.state === "DEGRADED" || vdev.state === "UNAVAIL" || vdev.state === "REMOVED") {
    const cls = vdev.redundancy_class;
    if (cls === "single" || cls === "stripe") {
      return { severity: "critical", reason: `${vdev.state.toLowerCase()} on zero-redundancy vdev` };
    }
    if (cls === "raidz1" || cls === "mirror_2way") {
      return { severity: "critical", reason: `${vdev.state.toLowerCase()} on ${cls}; zero remaining failure tolerance` };
    }
    if (cls === "raidz2") {
      return vdev.spare_in_progress
        ? { severity: "warning", reason: "raidz2 degraded with hot-spare recovery in progress" }
        : { severity: "critical", reason: "raidz2 degraded; one more failure to raidz1-equivalent" };
    }
    if (cls === "raidz3" || cls === "mirror_3way" || cls === "mirror_4way+") {
      return { severity: "warning", reason: `${vdev.state.toLowerCase()} on ${cls}; redundancy class retains tolerance` };
    }
    // Unknown redundancy_class (or pre-0.10.4 omission) - emit at
    // critical (preserve fail-loud semantics) with explicit reason.
    return { severity: "critical", reason: `${vdev.state.toLowerCase()} on vdev with unknown redundancy class` };
  }
  return null;
}

function buildZfsPoolEmission(
  pool: NonNullable<Snapshot["zfs"]>["pools"][number],
  opts: {
    severity: AlertResult["severity"];
    scope: "pool" | "vdev" | "pool_legacy" | "l2arc";
    reason: string;
    vdev?: ZfsVdevTyped;
    l2arc?: NonNullable<NonNullable<Snapshot["zfs"]>["pools"][number]["l2arc_vdevs"]>[number];
  },
): AlertResult {
  const titleSuffix =
    opts.scope === "vdev" && opts.vdev
      ? `vdev "${opts.vdev.name}" ${opts.vdev.state.toLowerCase()}`
      : opts.scope === "l2arc" && opts.l2arc
        ? `L2ARC vdev "${opts.l2arc.name}" ${opts.l2arc.state.toLowerCase()}`
        : pool.state.toLowerCase();
  return {
    type: "zfs_pool_unhealthy",
    severity: opts.severity,
    title: `ZFS pool "${pool.name}": ${titleSuffix}`,
    message: `Pool "${pool.name}": ${opts.reason}. ${pool.errors_text || "Run \"zpool status -v\" for details."}`,
    evidence: {
      pool: pool.name,
      pool_state: pool.state,
      scope: opts.scope,
      severity_reason: opts.reason,
      errors_text: pool.errors_text,
      ...(opts.vdev
        ? {
            vdev_name: opts.vdev.name,
            vdev_state: opts.vdev.state,
            vdev_redundancy_class: opts.vdev.redundancy_class ?? "unknown",
            spare_in_progress: opts.vdev.spare_in_progress ?? false,
          }
        : {}),
      ...(opts.l2arc
        ? { l2arc_vdev_name: opts.l2arc.name, l2arc_vdev_state: opts.l2arc.state }
        : {}),
      ...(opts.scope === "pool_legacy" ? { parser_quality: "legacy_uniform" } : {}),
    },
    recommendation:
      opts.scope === "l2arc"
        ? `L2ARC failure surfaces as a performance ticket; data is not at risk. Detach the failed cache device with \`zpool remove ${pool.name} <vdev>\` and replace at convenience.`
        : `Run \`zpool status -v ${pool.name}\` to identify the affected disk. Replace failed devices with \`zpool replace ${pool.name} <old> <new>\`. SUSPENDED pools require investigation of the underlying I/O path before reimport.`,
  };
}

// R-P2-2 (val-fleet campaign 2026-05-29): vendor-side physical-hardware
// remediations ("clean the dust", "swap the drive", "reseat the PSU")
// assume the operator can touch the chassis. That is false for rented /
// provider-managed servers, a large share of the target market. Append
// this ownership-branch note to the recommendation of every vendor-side
// physical rule (cpu_temperature_high vendor-side path, ipmi_fan_failure,
// psu_redundancy_loss, smart_failing, raid_degraded, ecc_errors,
// nvme_critical_warning) so the reader who can't physically service the
// box still has an actionable path. Single source of truth: if the copy
// changes, edit it here. The YAML FIX-workflow remediations carry the
// same note under an "If you cannot physically access the hardware"
// section; keep both surfaces in sync (see the YAML comment).
// OWNERSHIP_REMEDIATION_NOTE moved to $lib/alerts/vendor-facing (client-safe,
// single source of truth; the "Generate ticket draft" button keys on it).
// Imported at the top of this file.

/** RHEL-family (rhel/rocky/almalinux/centos/fedora, incl. via os_id_like)?
 *  Used to lead dual-distro recommendation strings with the commands that run
 *  on THIS host. A validation session showed the headline gets followed
 *  verbatim: a Debian-first string on an AlmaLinux host reads as "run apt".
 *  Unknown distro keeps the Debian-first ordering (the larger install base). */
function isRhelFamily(snap: Snapshot): boolean {
  const s = `${snap.system?.os_id ?? ""} ${snap.system?.os_id_like ?? ""}`.toLowerCase();
  return /rhel|rocky|alma|centos|fedora/.test(s);
}

/** Is kernel release `running` at least as new as `installed`?
 *
 *  Compares the numeric components of two kernel release strings, so
 *  "6.10.0-061000-generic" (-> [6,10,0,61000]) correctly outranks
 *  "6.8.0-136-generic" (-> [6,8,0,136]); a plain string compare gets this
 *  backwards because "10" sorts before "8". Non-numeric flavour text
 *  ("-generic", ".el9_5.x86_64") is ignored.
 *
 *  Returns FALSE when either side has no parseable version numbers, so callers
 *  fall back to whatever signal they already had rather than suppressing an
 *  alert on an unrecognised format. */
function runningKernelAtLeastInstalled(running: string, installed: string): boolean {
  const parts = (v: string): number[] => (v.match(/\d+/g) ?? []).map(Number);
  const r = parts(running);
  const i = parts(installed);
  if (r.length === 0 || i.length === 0) return false;
  for (let n = 0; n < Math.max(r.length, i.length); n++) {
    const rv = r[n] ?? 0;
    const iv = i[n] ?? 0;
    if (rv > iv) return true;
    if (rv < iv) return false;
  }
  return true;
}

/**
 * Is the reporting agent at least `min`? Numeric per component, so 0.14.9 does not
 * outrank 0.14.11 the way a string compare would.
 *
 * An absent or unparseable version returns FALSE, i.e. "cannot be trusted". That
 * direction matters: this is used to decide whether a field's ABSENCE is meaningful,
 * and treating an unknown agent as new would make absence read as good news, which is
 * the exact mistake that produced the fleet-wide false positive.
 */
export function agentAtLeast(version: string | undefined, min: string): boolean {
const parse = (v: string) => {
  // ANCHORED at both ends. Unanchored, "0.14.11-rc.1" and "0.14.11garbage" both
  // parsed as [0,14,11] and returned true, contradicting this function's whole
  // contract that an unparseable version is NOT trusted, and letting a malformed or
  // prerelease agent switch on the trusted mount-namespace interpretation.
  // Adversarial review round 4, finding #5.
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const have = version ? parse(version) : null;
const need = parse(min);
if (!have || !need) return false;
for (let i = 0; i < 3; i++) {
  if (have[i] > need[i]) return true;
  if (have[i] < need[i]) return false;
}
return true;
}

const rules: AlertRule[] = [
  // === OS (5) ===

  // 1. RAM usage high
  //
  // Trigger redesign per pattern library Category 2 (2026-05-18,
  // RULE_AUDIT_VERDICTS_2026-05-18.md §3A): switch primary metric from
  // `used_mb / total_mb` to `MemAvailable / total_mb`. Linux's MemAvailable
  // accounts for reclaimable page cache + slab, so `used%` ≥ 90 is normal
  // on many workloads with zero real memory pressure (the cache absorbs
  // the high used number). The honest pressure signal is "less than N%
  // memory genuinely available."
  //
  // Trending-down gate deferred: spec calls for "AND trending down over
  // 30+ min" but evaluator.ts is single-snapshot. The trending check
  // belongs in a future cross-snapshot evaluator pass; documenting the
  // gap in the rule's source_note so customers can interpret a fire as
  // "snapshot-level pressure" not "sustained pressure."
  //
  // Capability gate: prefer MemAvailable when present; older agents
  // without it fall back to the old used% logic with `available: false`
  // in evidence so customers see why the legacy trigger fired.
  {
    type: "ram_high",
    evaluate(snap, config) {
      if (!snap.memory || !snap.memory.total_mb) return [];
      const hasAvailable = typeof snap.memory.available_mb === "number" && snap.memory.available_mb > 0;

      if (hasAvailable) {
        const availPct = (snap.memory.available_mb / snap.memory.total_mb) * 100;
        // ram_available_threshold_percent (default 5%) matches the pattern
        // library. Critical band hard-coded at 2%. Customers who set
        // ram_threshold_percent on the legacy rule do not see the new
        // semantics; they must set ram_available_threshold_percent to
        // adjust the MemAvailable trigger.
        const availThreshold = config.ram_available_threshold_percent ?? 5;
        if (availPct >= availThreshold) return [];
        return [{
          type: "ram_high",
          severity: availPct < 2 ? "critical" : "warning",
          title: `Available RAM at ${availPct.toFixed(1)}% of total`,
          message: `Only ${fmtMB(snap.memory.available_mb)} of ${fmtMB(snap.memory.total_mb)} RAM is available (${availPct.toFixed(1)}%). MemAvailable accounts for reclaimable cache; this is genuine pressure.`,
          evidence: {
            available_mb: snap.memory.available_mb,
            total_mb: snap.memory.total_mb,
            available_percent: Math.round(availPct * 10) / 10,
            used_mb: snap.memory.used_mb,
            trigger: "memavailable",
          },
          recommendation: "Identify top memory consumers with `ps aux --sort=-rss | head -20`. Consider adding RAM or restarting the suspected leaking service.",
        }];
      }

      // Capability-gate fallback: old agent that doesn't ship available_mb.
      // Keep the legacy used% threshold so the rule still fires.
      const pct = (snap.memory.used_mb / snap.memory.total_mb) * 100;
      const threshold = config.ram_threshold_percent ?? 90;
      if (pct < threshold) return [];
      return [{
        type: "ram_high",
        severity: pct >= 95 ? "critical" : "warning",
        title: `RAM usage at ${pct.toFixed(1)}%`,
        message: `Server is using ${fmtMB(snap.memory.used_mb)} of ${fmtMB(snap.memory.total_mb)} RAM. Only ${fmtMB(snap.memory.available_mb)} available.`,
        evidence: {
          used_mb: snap.memory.used_mb,
          total_mb: snap.memory.total_mb,
          percent: Math.round(pct * 10) / 10,
          trigger: "legacy_used_percent",
          available: false,
        },
        recommendation: "Identify top memory consumers with `ps aux --sort=-rss | head -20`. Consider adding RAM or optimizing application memory usage. (Upgrade Crucible to ship MemAvailable for accurate pressure detection.)",
      }];
    },
  },

  // 2. CPU utilization high
  {
    type: "cpu_high",
    evaluate(snap) {
      if (!snap.cpu) return [];
      const usage = 100 - (snap.cpu.idle_percent ?? 100);
      if (usage < 90) return [];
      return [{
        type: "cpu_high",
        severity: usage >= 98 ? "critical" : "warning",
        title: `CPU at ${usage.toFixed(1)}%`,
        message: `Aggregate CPU utilization at ${usage.toFixed(1)}%. ${usage >= 98 ? "Critical threshold: 98%." : "Warning threshold: 90%."}`,
        evidence: { usage_percent: Math.round(usage * 10) / 10, user: snap.cpu.user_percent, system: snap.cpu.system_percent, iowait: snap.cpu.iowait_percent },
        recommendation: "Identify top CPU consumers with `top -bn1 | head -20` or `ps aux --sort=-%cpu | head -20`.",
      }];
    },
  },

  // 3. Load average high
  {
    type: "load_high",
    // Tiered threshold (campaign finding 2026-05-20):
    //   warning at load_1m >= cores * 1.5 (saturated + some queuing)
    //   critical at load_1m >= cores * 3.0 (severe overload)
    //
    // The original threshold was a single 2x-cores warning, which on
    // big hosts (val-mz62hd, 64 cores) meant load_1m=60 (~94% of
    // 1.0x) didn't fire even though CPU was visibly saturated.
    // Operationally that's too late an early-warning band. The new
    // 1.5x warning catches "saturated and queuing" while 3x critical
    // preserves the "page someone" signal for severe overload.
    //
    // Why 1.5x and not 1.0x: load == cores is normal under any
    // batch-y workload (compile, backup, parallel test runner). 1.5x
    // is the band where queue depth is starting to translate to
    // user-visible latency without being routine spike behaviour.
    // Why 3.0x and not 2.0x: with the warning band at 1.5x, we have
    // headroom to push critical higher; 3x is "this is genuinely
    // overloaded, not just running its load."
    evaluate(snap) {
      if (!snap.cpu) return [];
      const coreCount = snap.cpu.cores?.length || 1;
      const warnThreshold = coreCount * 1.5;
      const critThreshold = coreCount * 3.0;
      if (snap.cpu.load_1m < warnThreshold) return [];
      const isCritical = snap.cpu.load_1m >= critThreshold;
      const ratio = snap.cpu.load_1m / coreCount;
      return [{
        type: "load_high",
        severity: isCritical ? "critical" : "warning",
        title: `Load ${snap.cpu.load_1m.toFixed(2)} at ${ratio.toFixed(1)}x the ${coreCount}-core count`,
        message: `Load average (1 min) is ${snap.cpu.load_1m.toFixed(2)}, which is ${ratio.toFixed(1)}x the ${coreCount} core count. ${isCritical ? `Critical (>= 3x cores): severely overloaded.` : `Warning (>= 1.5x cores): saturated with queuing.`}`,
        evidence: {
          load_1m: snap.cpu.load_1m,
          load_5m: snap.cpu.load_5m,
          core_count: coreCount,
          ratio_to_cores: Number(ratio.toFixed(2)),
          warn_threshold: warnThreshold,
          crit_threshold: critThreshold,
        },
        recommendation: "Check for runaway processes with `ps aux --sort=-%cpu | head -20`. High load with low CPU often means I/O bottleneck: run `iostat -xz 1 5`.",
      }];
    },
  },

  // 4. Disk space high
  {
    type: "disk_space_high",
    evaluate(snap, config) {
      if (!snap.disks) return [];
      const threshold = config.disk_threshold_percent ?? 85;
      const results: AlertResult[] = [];
      for (const disk of snap.disks) {
        if (disk.percent_used < threshold) continue;
        results.push({
          type: "disk_space_high",
          severity: disk.percent_used >= 95 ? "critical" : "warning",
          title: `Disk ${disk.mount} at ${disk.percent_used}%`,
          message: `${disk.device} mounted at ${disk.mount}: ${fmtGB(disk.used_gb)} used of ${fmtGB(disk.total_gb)}. ${fmtGB(disk.available_gb)} available.`,
          evidence: { device: disk.device, mount: disk.mount, percent_used: disk.percent_used, available_gb: disk.available_gb },
          recommendation: `Find what is filling ${disk.mount}: \`sudo du -xsh ${disk.mount}/* 2>/dev/null | sort -rh | head -20\` (the -x keeps it on this one filesystem). Common culprits: old logs, tmp files, unrotated journals, unused packages.`,
        });
      }
      return results;
    },
  },

  // Cross-snapshot rule: classifier for accept-backlog buildup or
  // SYN flood. Fires P1 when 2+ of conntrack_exhaustion /
  // listen_overflow / tcp_retrans_high have active alerts on the
  // same host within 5 minutes. Pulls the cross-rule correlation
  // payload from the pre-pass (ctx.cross_snapshot.correlation).
  // Per CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §3.2.
  //
  // Status: conntrack_exhaustion exists; listen_overflow +
  // tcp_retrans_high don't yet. This rule won't fire until 2+ are
  // live. Shipping the structure now keeps the surface
  // forward-compatible without further code change when the
  // subordinates arrive.
  {
    type: "accept_backlog_or_syn_flood",
    evaluate(_snap, _config, ctx) {
      const correlation = ctx?.cross_snapshot?.correlation;
      if (!correlation || correlation.matched.length < 2) return [];
      return [
        {
          type: "accept_backlog_or_syn_flood",
          severity: "critical",
          title: "Accept backlog or SYN flood detected",
          message: `${correlation.matched.length} subordinate rules active concurrently within 5 minutes: ${correlation.matched.join(", ")}. Consolidated into one incident.`,
          evidence: {
            matched_rules: correlation.matched,
            rules_matched_count: correlation.matched.length,
            incident_started_at_ms: correlation.oldest_first_seen_ms,
            window_seconds: 300,
          },
          recommendation:
            "Triage with `ss -nt state syn-recv | head` (SYN-RECV concentration) and `ss -nts` (queue stats). Concentrated source IPs => rate-limit; distributed => raise net.core.somaxconn and tcp_max_syn_backlog. See the rule's fix.variants for commands.",
        },
      ];
    },
  },

  // Cross-snapshot rule: linear projection on per-mount available
  // space. Companion to disk_space_high (absolute %). Uses the
  // pre-pass payload (ctx.cross_snapshot.snapshots) to read the last
  // 6 snapshots of disks[] and emit P1 < 24h-to-full / P2 < 7d-to-full.
  // Per CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §3.1.
  {
    type: "disk_fill_projection",
    evaluate(snap, _config, ctx) {
      const payload = ctx?.cross_snapshot;
      if (!payload || payload.snapshots.length < 4) return [];
      if (!snap.disks) return [];

      const results: AlertResult[] = [];
      const now = Date.now();

      // For each currently-mounted filesystem, gather the last-6-
      // snapshots (mount, available_bytes) timeseries and regress.
      for (const current of snap.disks) {
        // Skip pseudo-mounts that don't make sense to project (tmpfs
        // etc.). Heuristic: project only mounts with a real device
        // and non-zero total_gb.
        if (!current.mount || !current.device) continue;
        if (current.total_gb <= 0) continue;

        const points: Array<{ t: number; v: number }> = [];
        for (const row of payload.snapshots) {
          // parsed: true; disks arrives already parsed (or null on
          // malformed). Be defensive.
          const disks = (row as { disks?: unknown }).disks;
          if (!Array.isArray(disks)) continue;
          const entry = (disks as Array<{ mount: string; available_gb?: number }>).find(
            (d) => d.mount === current.mount,
          );
          if (!entry || entry.available_gb == null) continue;
          points.push({
            t: row.timestamp,
            v: entry.available_gb * 1_073_741_824,
          });
        }
        if (points.length < 4) continue;

        const projection = linearProjection(points, 0);
        if (projection.slope_per_day >= 0) continue; // Growing or flat.
        if (projection.crosses_at_ms === null) continue;

        const hoursToFull = (projection.crosses_at_ms - now) / 3_600_000;
        if (hoursToFull >= 168) continue; // > 7 days; no emission.

        // Suppress projections on disks that are not yet meaningfully full.
        // A linear fit over a SHORT window (here ~6 samples) turns a transient
        // write burst (a nightly job, a log, a ClickHouse merge) into a steep
        // "fills in N days" slope even on a disk with hundreds of GB of headroom
        // that is not actually trending toward full. Observed on `services`: 27
        // self-resolving events at 26-28% used with ~330 GB free, projecting
        // "full in 2-6 days" from momentary bursts (2026-07-15); the earlier
        // mz62hd case (2% used, 458 GB free) is the same shape. Gate on
        // current_percent_used: a "days to full" projection is only credible and
        // actionable once the disk is genuinely getting full, and 40% still
        // leaves ample runway at the 7-day horizon. (Deeper fix, a longer /
        // sustained regression window that ignores transient bursts, is a
        // follow-up: it needs the cross-snapshot payload to carry more history.)
        const currentPercentUsed = current.total_gb > 0
          ? ((current.total_gb - current.available_gb) / current.total_gb) * 100
          : 0;
        const CURRENT_PERCENT_FLOOR = 40;
        if (currentPercentUsed < CURRENT_PERCENT_FLOOR) continue;

        const severity: AlertResult["severity"] =
          hoursToFull < 24 ? "critical" : "warning";
        const fillRateGiBPerDay = -projection.slope_per_day / 1_073_741_824;

        results.push({
          type: "disk_fill_projection",
          severity,
          // Title leads with the growth rate so the operator sees the
          // actionable number first; "projected full in X" is now
          // qualified context. Was: "Disk / projected full in 5.6d"
          // which read alarmist on a 2%-used disk.
          title: `Disk ${current.mount} filling at ${fillRateGiBPerDay.toFixed(1)} GB/day (${
            hoursToFull < 24 ? `full in ${hoursToFull.toFixed(1)}h` : `full in ${(hoursToFull / 24).toFixed(1)}d`
          })`,
          message: `Linear regression on ${current.mount} (${current.device}) over the last ${points.length} snapshots projects available_bytes reaching zero in ~${hoursToFull.toFixed(1)} hours. Current: ${currentPercentUsed.toFixed(0)}% used, ${current.available_gb.toFixed(1)} GB free. Fill rate ${fillRateGiBPerDay.toFixed(2)} GB/day.`,
          evidence: {
            mount: current.mount,
            device: current.device,
            hours_to_full: Number(hoursToFull.toFixed(2)),
            slope_bytes_per_day: Math.round(projection.slope_per_day),
            available_bytes_current: Math.round(current.available_gb * 1_073_741_824),
            current_percent_used: Number(currentPercentUsed.toFixed(1)),
            samples: points.length,
          },
          recommendation: `Identify largest accumulators: \`sudo du -xh -d 1 ${current.mount} | sort -rh | head -20\`. The slope tells you the rate; if it's accelerating, plan for volume extension rather than just cleanup.`,
        });
      }

      return results;
    },
  },

  // 4. CPU iowait high
  {
    type: "cpu_iowait_high",
    evaluate(snap, config) {
      if (!snap.cpu) return [];
      const threshold = config.iowait_threshold_percent ?? 20;
      if (snap.cpu.iowait_percent < threshold) return [];
      // iowait% is the fraction of idle CPU time spent waiting on I/O. On a
      // near-idle box (load ~0), trivial background I/O becomes a huge
      // percentage of near-zero activity, so high iowait% with no load is a
      // measurement artifact, not a disk problem (round 5: idle-box false
      // alarm, e.g. 34% iowait at load 0.04 on a healthy 5 GB/s NVMe). Require
      // a minimum 1-minute load before treating iowait as meaningful.
      const MIN_LOAD_1M = config.iowait_min_load_1m ?? 1.0;
      if ((snap.cpu.load_1m ?? 0) < MIN_LOAD_1M) return [];
      return [{
        type: "cpu_iowait_high",
        severity: "warning",
        title: `CPU iowait at ${snap.cpu.iowait_percent.toFixed(1)}%`,
        message: `High I/O wait indicates the CPU is spending ${snap.cpu.iowait_percent.toFixed(1)}% of its time waiting for disk operations.`,
        evidence: { iowait_percent: snap.cpu.iowait_percent, load_1m: snap.cpu.load_1m },
        recommendation: "Check for I/O-heavy processes with `iotop -oP` or `iostat -x 1 5`. Common causes: database queries, log rotation, backup jobs.",
      }];
    },
  },

  // 5. OOM kills
  {
    type: "oom_kills",
    evaluate(snap) {
      if (!snap.os_alerts || snap.os_alerts.oom_kills_recent <= 0) return [];
      return [{
        type: "oom_kills",
        severity: "critical",
        title: `${snap.os_alerts.oom_kills_recent} OOM kill(s) detected`,
        message: `The kernel out-of-memory killer terminated ${snap.os_alerts.oom_kills_recent} process(es) recently. Services may be down.`,
        evidence: { oom_kills_recent: snap.os_alerts.oom_kills_recent },
        recommendation: "Check `dmesg | grep -i 'killed process'` to see which process was killed. For a systemd unit, check its `MemoryMax`/`MemoryHigh` first: a too-low limit OOM-kills a healthy workload (raise or remove the limit). Otherwise fix the leak or the workload; add RAM only if the whole host is genuinely out of memory.",
      }];
    },
  },

  // === Storage (4) ===

  // 6. SMART failing
  //
  // Fires CRITICAL on LATCHING failure signals only: aggregate health != PASSED,
  // or reallocated_sectors > 0. Both only ever go up, so a single snapshot showing
  // one is trustworthy.
  //
  // pending_sectors (SMART attr 197) is DELIBERATELY NOT a trigger here, and that is
  // a correctness fix, not an omission. Pending oscillates by design: a drive marks a
  // sector suspect, retries it later, and either clears it or retires it. Worse, some
  // vendors relabel attr 197 as an ECC bookkeeping counter that ticks 0 -> 1 -> 0 on
  // perfectly healthy drives. Crucial MX500 firmware does exactly this, and it made
  // this rule fire 35 CRITICALs in four days across two hosts, every one at pending=1,
  // never higher, never with any corroborating signal, cleared on the next poll. That
  // is the alert operators can least afford to be trained to ignore.
  //
  // The per-snapshot evaluator cannot tell a benign flap from a real held rise,
  // because it has no history. The trend engine can, and already does: attr 197 is
  // covered there as smart_197_step_change (rose from 0 to N and held) and
  // smart_197_recurring (flapped repeatedly), at scheduled severity. That is the
  // correct home for an oscillating signal. The true-positive case is unaffected: a
  // genuinely failing drive retires the pending sectors, and reallocated_sectors then
  // carries the CRITICAL. Verified live on the fleet's one failing drive (HGST at 477
  // reallocated), which fires on reallocated with pending currently at 0.
  //
  // `triggering_signals` names exactly the conditions that fired so a customer does
  // not see `smart_failing critical` with `health: PASSED` and get puzzled. Codex
  // experiment 2026-05-12; pending removed as a trigger 2026-08-04 (MX500 false
  // positive).
  {
    type: "smart_failing",
    evaluate(snap) {
      if (!snap.smart) return [];
      const results: AlertResult[] = [];
      for (const drive of snap.smart) {
        const issues: string[] = [];
        const triggering_signals: Array<{
          attribute: "health" | "reallocated_sectors";
          observed: string | number;
          reason: string;
        }> = [];
        if (drive.health && drive.health !== "PASSED") {
          issues.push(`Health: ${drive.health}`);
          triggering_signals.push({
            attribute: "health",
            observed: drive.health,
            reason: `SMART aggregate health is "${drive.health}" (expected "PASSED")`,
          });
        }
        if (drive.reallocated_sectors && drive.reallocated_sectors > 0) {
          issues.push(`${drive.reallocated_sectors} reallocated sectors`);
          triggering_signals.push({
            attribute: "reallocated_sectors",
            observed: drive.reallocated_sectors,
            reason: `Reallocated sector count is ${drive.reallocated_sectors} (expected 0). Any non-zero count means the drive has remapped failing sectors.`,
          });
        }
        if (issues.length === 0) continue;
        // Serial-first identification: /dev/ letters can move across reboots
        // when identical drives are present; replacing "the sda drive" by
        // letter alone can pull the healthy unit.
        results.push({
          type: "smart_failing",
          severity: "critical",
          title: `SMART failure on ${drive.serial ? `${drive.device} (S/N ${drive.serial})` : drive.device}`,
          message: `${drive.model || drive.device}${drive.serial ? ` S/N ${drive.serial}` : ""}: ${issues.join(", ")}. This drive is showing signs of failure.`,
          evidence: {
            device: drive.device,
            model: drive.model,
            serial: drive.serial,
            firmware: drive.firmware,
            health: drive.health,
            reallocated_sectors: drive.reallocated_sectors,
            pending_sectors: drive.pending_sectors,
            triggering_signals,
            fix_commands: [
              `# Confirm you have the right physical unit FIRST: match the serial`,
              `# (device letters can move across reboots when identical drives exist)`,
              `sudo smartctl -i ${drive.device}${drive.serial ? `   # expect S/N ${drive.serial}` : ""}`,
              "",
              `# Check full SMART report for ${drive.device}`,
              `sudo smartctl -a ${drive.device}`,
              "",
              "# Run SMART self-test (short, non-destructive)",
              `sudo smartctl -t short ${drive.device}`,
              "",
              "# Check self-test results after ~2 minutes",
              `sudo smartctl -l selftest ${drive.device}`,
              "",
              "# Check for RAID membership before replacing",
              "cat /proc/mdstat",
              `lsblk ${drive.device}`,
            ],
          },
          recommendation: `Schedule drive replacement for ${drive.serial ? `S/N ${drive.serial} (currently ${drive.device})` : drive.device}. Back up data immediately. Run \`smartctl -a ${drive.device}\` for full details and confirm the serial with \`smartctl -i\` before any swap; device letters can move across reboots. ${OWNERSHIP_REMEDIATION_NOTE}`,
        });
      }
      return results;
    },
  },

  // drive_smart_unreadable: a MONITORING BLIND SPOT, not a drive fault. Crucible
  // reports fixed disks present in /sys/block whose SMART it could NOT read
  // (smartctl not installed, or a controller needing a `-d` type it does not
  // try). Without this signal such a host reports zero drives and is
  // indistinguishable from a diskless host, so a real failure on an unreadable
  // drive would go silently unmonitored (bit us live on val-hdd-destroy-1, which
  // shipped without smartmontools). Capability-gated on snap.smart_unreadable
  // (Crucible 0.14.4+): older agents and hosts with fully-readable SMART omit
  // the field and never fire. P2 warning ceiling; never pages (paging keys off
  // priority), ack-able when the device genuinely has no SMART. Crucible already
  // suppresses the marker on a healthy HW-RAID box (the controller's own virtual
  // disk), so this does not fire on a working MegaRAID host.
  {
    type: "drive_smart_unreadable",
    evaluate(snap) {
      const unreadable = snap.smart_unreadable;
      if (!unreadable || unreadable.length === 0) return [];
      const n = unreadable.length;
      const devices = unreadable.map((u) => u.device);
      const list = devices.join(", ");
      const missingTool = unreadable.some((u) => u.reason === "no_smartctl_output");
      const noType = unreadable.some((u) => u.reason === "no_smart_data");
      // Lead with the most-actionable cause. smartctl-missing is the common,
      // cheap fix; an unsupported controller needs a `-d` type investigation.
      const cause = missingTool
        ? "smartmontools (smartctl) appears to be missing or is failing to run"
        : noType
          ? "the drive is behind a controller that needs a device type smartctl was not given"
          : "smartctl output could not be read";
      const remediation = missingTool
        ? "Install smartmontools so Crucible can read drive health."
        : "Confirm the correct `smartctl -d` device type for this controller (start with `smartctl --scan-open`).";
      const drivePhrase = n === 1 ? "this disk" : "these disks";
      return [{
        type: "drive_smart_unreadable",
        severity: "warning",
        title: `SMART unreadable on ${n} disk${n === 1 ? "" : "s"}`,
        message: `${n} fixed disk${n === 1 ? " is" : "s are"} present but SMART is unreadable (${list}): ${cause}. This is not a drive fault; it is a monitoring blind spot: while SMART is unreadable, a real failure on ${drivePhrase} would go undetected. ${remediation} Acknowledge if this is understood and accepted (some virtual/enclosure devices genuinely expose no SMART).`,
        evidence: {
          count: n,
          unreadable_devices: unreadable,
          reasons: Array.from(new Set(unreadable.map((u) => u.reason))),
          fix_commands: [
            "# 1. Is smartmontools installed?",
            "which smartctl || echo 'smartctl NOT found'",
            "",
            "# 2a. Install it (Debian/Ubuntu):",
            "sudo apt-get update && sudo apt-get install -y smartmontools",
            "# 2b. Install it (RHEL/Rocky/Alma/Fedora):",
            "sudo dnf install -y smartmontools",
            "",
            "# 3. Confirm each disk is now readable (match by device):",
            ...devices.map((d) => `sudo smartctl -H ${d}`),
            "",
            "# 4. If a disk is behind a RAID/HBA that needs a device type, discover it:",
            "sudo smartctl --scan-open",
            "#    then read with the reported type, e.g.:",
            "#    sudo smartctl -H -d sat+megaraid,0 /dev/bus/0",
          ],
        },
        recommendation: `Advisory, not a fault: ${n} disk${n === 1 ? " is" : "s are"} present but SMART health is unreadable, so a failure would be invisible to monitoring. ${remediation} If the device genuinely has no SMART (some virtual/enclosure devices), acknowledge this advisory. ${OWNERSHIP_REMEDIATION_NOTE}`,
      }];
    },
  },

  // 7. Drive endurance / wear high (SSD + NVMe).
  //
  // Rule id kept as `nvme_wear_high` for history / profile / docs / test
  // stability, but it now covers SATA SSDs too: Crucible maps a SATA SSD's wear
  // attribute (Micron/Crucial 202, Intel 233, Samsung 177, etc.) into
  // percentage_used the same way it does for NVMe (crucible smart.ts), so a
  // worn SATA SSD (a Crucial MX500 at 25% life remaining = 75% used) is no
  // longer invisible to wear detection. Three tiers: watch (info) >= watchAt,
  // warning >= nvme_wear_percent, critical >= 95.
  {
    type: "nvme_wear_high",
    evaluate(snap, config) {
      if (!snap.smart) return [];
      const warnAt = config.nvme_wear_percent ?? 85;
      const watchAt = Math.min(config.ssd_wear_watch_percent ?? 75, warnAt);
      const results: AlertResult[] = [];
      for (const drive of snap.smart) {
        if (drive.percentage_used == null || drive.percentage_used < watchAt) continue;
        const used = drive.percentage_used;
        const severity: "critical" | "warning" | "info" =
          used >= 95 ? "critical" : used >= warnAt ? "warning" : "info";
        const urgency =
          used >= 95 ? "Replace immediately." : used >= warnAt
            ? "Schedule replacement within the next maintenance window."
            : "Well-worn but not urgent; budget a replacement.";
        // The serial leads the identification: /dev/ letters are NOT stable
        // across reboots when identical drives are present (a val-campaign
        // session verified the wrong MX500 exactly this way and concluded
        // the alert was wrong; it was right).
        const wearId = drive.serial ? `${drive.device} (S/N ${drive.serial})` : drive.device;
        results.push({
          type: "nvme_wear_high",
          severity,
          title: `Drive ${wearId} endurance at ${used}% used`,
          message: `${drive.model || drive.device}${drive.serial ? ` S/N ${drive.serial}` : ""} has used ${used}% of its rated write endurance.${used >= warnAt ? "" : " Not failing (no errors), but well into its wear life."} Identify the physical unit by serial (smartctl -i); device letters can move across reboots.`,
          evidence: {
            device: drive.device, model: drive.model, serial: drive.serial, firmware: drive.firmware,
            percentage_used: used, power_on_hours: drive.power_on_hours,
            // Corroborating health counters: a hoster asked to swap a worn
            // drive wants proof it is wear (not errors) and the exact unit.
            // The ticket-draft extractor prints these verbatim.
            health: drive.health, reallocated_sectors: drive.reallocated_sectors, pending_sectors: drive.pending_sectors,
            fix_commands: [
              `# Confirm you have the right physical unit FIRST: match the serial`,
              `# (device letters can move across reboots when identical drives exist)`,
              `sudo smartctl -i ${drive.device}${drive.serial ? `   # expect S/N ${drive.serial}` : ""}`,
              "",
              `# Check drive health + wear detail for ${drive.device}`,
              `sudo smartctl -a ${drive.device}`,
              "",
              "# NVMe drives also expose a dedicated wear log:",
              `sudo nvme smart-log ${drive.device} 2>/dev/null || true`,
              "",
              "# Plan replacement: check RAID/partition layout",
              `lsblk ${drive.device}`,
              "cat /proc/mdstat",
            ],
          },
          recommendation: `Plan drive replacement. Check warranty status. ${urgency} ${OWNERSHIP_REMEDIATION_NOTE}`,
        });
      }
      return results;
    },
  },

  // 8. RAID degraded
  //
  // Two emission paths, both at critical (P1) severity:
  //   - Software RAID: snap.raid (mdadm). Fleet-tested.
  //   - Hardware RAID: snap.hardware_raid.controllers (Crucible C5,
  //     v0.10.4+). Activated per CC_SPEC_FORGE_C1_C6_DEFERRED_TUNES.
  //     dell/lsi parsers (perccli/storcli) are fleet-tested via
  //     synthetic fixtures; hpe/adaptec (ssacli/arcconf) are stub
  //     parsers in v0.10.4 awaiting customer validation. The
  //     evidence.parser_quality field flags which one applies so the
  //     alert prose can be honest in the UI.
  //
  // Capability gating: a host with neither field present yields no
  // emission. Hosts with software-only or hardware-only RAID hit
  // exactly one branch.
  {
    type: "raid_degraded",
    evaluate(snap) {
      const results: AlertResult[] = [];

      // Software RAID (mdadm).
      if (snap.raid) {
        for (const array of snap.raid) {
          if (!array.degraded && (!array.failed_disks || array.failed_disks.length === 0)) continue;
          // Resolve each failed member to its physical-drive identity (model +
          // serial) from the same snapshot's SMART, so a provider ticket can name
          // the exact drive to pull. Best-effort: a disk gone from the SMART scan
          // resolves to null identity and we keep just the member name.
          const failedMembers = resolveFailedMembers(array.failed_disks, snap.smart);
          results.push({
            type: "raid_degraded",
            severity: "critical",
            title: `RAID ${array.device} degraded`,
            message: `${array.device} (${array.level}) is degraded. Failed disks: ${array.failed_disks.join(", ") || "unknown"}. One more failure means data loss.`,
            evidence: {
              raid_kind: "mdadm",
              device: array.device,
              level: array.level,
              failed_disks: array.failed_disks,
              failed_members: failedMembers,
              parser_quality: "fleet-tested",
            },
            recommendation: `Triage the failed member first: \`smartctl -H\` on that disk and \`dmesg -T | grep <member>\` for I/O errors. A transient drop (link reset, controller hiccup) with a healthy drive re-joins in seconds via \`mdadm --manage /dev/${array.device} --re-add /dev/<member>\` (write-intent bitmap). Replace the drive instead if it shows real errors, re-fails after re-add, or is already wear/SMART-flagged. Status: \`cat /proc/mdstat\`, \`mdadm --detail /dev/${array.device}\`. ${OWNERSHIP_REMEDIATION_NOTE}`,
          });
        }
      }

      // Hardware RAID controllers (Crucible v0.10.4+).
      if (snap.hardware_raid?.controllers) {
        for (const ctrl of snap.hardware_raid.controllers) {
          if (ctrl.state === "Optimal") continue;
          const parserQuality =
            ctrl.vendor === "dell" || ctrl.vendor === "lsi"
              ? "fleet-tested"
              : "stub";
          const vendorLabel =
            ctrl.vendor === "dell"
              ? "Dell PERC"
              : ctrl.vendor === "lsi"
                ? "LSI/Broadcom MegaRAID"
                : ctrl.vendor === "hpe"
                  ? "HPE Smart Array"
                  : "Adaptec";
          const cli =
            ctrl.vendor === "dell"
              ? "perccli /c0 show all"
              : ctrl.vendor === "lsi"
                ? "storcli /c0 show all"
                : ctrl.vendor === "hpe"
                  ? "ssacli ctrl all show config detail"
                  : "arcconf getconfig 1";
          const stubNote =
            parserQuality === "stub"
              ? " Parser for this vendor is a stub in Crucible v0.10.4; verify evidence against the controller CLI directly before acting."
              : "";
          results.push({
            type: "raid_degraded",
            severity: "critical",
            title: `Hardware RAID degraded: ${vendorLabel} ${ctrl.controller_id}`,
            message: `${vendorLabel} controller ${ctrl.controller_id} reports state "${ctrl.state}"${
              ctrl.degraded_disks != null ? `; ${ctrl.degraded_disks} disk(s) degraded` : ""
            }. One more failure may cause data loss.${stubNote}`,
            evidence: {
              raid_kind: "hardware",
              controller_vendor: ctrl.vendor,
              controller_id: ctrl.controller_id,
              controller_state: ctrl.state,
              degraded_disks: ctrl.degraded_disks,
              raw_summary: ctrl.raw_summary,
              parser_quality: parserQuality,
            },
            recommendation: `Inspect the controller via vendor CLI: \`${cli}\`. Identify the failed drive's slot/serial and replace it. Confirm with the controller that the rebuild started; ZFS-on-hardware-RAID configurations should also check \`zpool status\`. ${OWNERSHIP_REMEDIATION_NOTE}`,
          });
        }
      }

      return results;
    },
  },

  // 9. Disk latency high (uses io_latency from /proc/diskstats deltas)
  //
  // 2026-05-18 audit DEMOTE to P3 (pattern library Cat 3): standalone
  // latency is a workload signal, not a hardware fault. Operators get
  // value from this rule as contextual evidence (correlated with
  // smart_failing or disk_io_errors) more than as a paging trigger.
  // Per-device-class thresholds: NVMe 1ms warning / 5ms critical; SSD
  // 10ms / 50ms; HDD 50ms / 200ms. Class inference is device-name
  // based; SMART model heuristic deferred (would need rotation_rate
  // collection from Crucible, see C-series in spec §7).
  {
    type: "disk_latency_high",
    evaluate(snap, config) {
      if (!snap.io_latency || !Array.isArray(snap.io_latency)) return [];
      const results: AlertResult[] = [];
      for (const dev of snap.io_latency) {
        const readLat = dev.avg_read_latency_ms;
        const writeLat = dev.avg_write_latency_ms;
        const totalIops = dev.read_iops + dev.write_iops;
        if (totalIops === 0) continue;

        // Device class inference. nvme* = NVMe; everything else = HDD
        // until Crucible ships rotation_rate to distinguish SSD vs HDD.
        // Customers running SATA SSDs get HDD-tier thresholds today
        // (50/200ms); they can override via disk_latency_hdd_ms if
        // their SSD-heavy fleet wants tighter trigger bands.
        const isNvme = dev.device.startsWith("nvme");
        const warningMs = isNvme
          ? config.disk_latency_nvme_ms ?? 1
          : config.disk_latency_hdd_ms ?? 50;
        const criticalMs = warningMs * 5;

        const worstLat = Math.max(readLat ?? 0, writeLat ?? 0);
        if (worstLat < warningMs) continue;

        const which = (readLat ?? 0) >= (writeLat ?? 0) ? "read" : "write";
        const busyIops = which === "read" ? dev.read_iops : dev.write_iops;
        const deviceClass = isNvme ? "NVMe" : "HDD/SSD";

        // RAID resync/recovery drives high latency by design (rebuild/scrub).
        // Suppress while the matching md array is recovering; it is expected
        // and self-resolves when the rebuild completes.
        const arr = snap.raid?.find((r) => r.device === dev.device);
        if (arr && /recover|resync|rebuild|check|repair/i.test(arr.status)) continue;

        // Saturation vs sick device. High latency at HIGH throughput is the
        // device/array being saturated by load (e.g. Docker-on-loopback over
        // RAID: heavy write bursts spike latency on a perfectly healthy array),
        // not a failing drive. High latency at LOW throughput is a genuinely
        // slow device. Only the latter is critical-worthy; saturation is
        // downgraded to info so it does not page (round 2, B-3).
        //
        // Crucible reports read_iops/write_iops as operation COUNTS over its
        // collection interval, so divide by that interval for a TRUE per-second
        // rate and compare against a per-second bar. Interval-robust: the same
        // physical workload classifies identically regardless of a host's
        // configured interval (a fixed per-interval-count bar did not; Codex
        // re-review 2026-07-18). Interval comes from the server record via
        // config.collection_interval_seconds (falls back to the 300s default).
        const intervalSec = config.collection_interval_seconds && config.collection_interval_seconds > 0
          ? config.collection_interval_seconds
          : 300;
        const busyIopsPerSec = Math.round((busyIops / intervalSec) * 10) / 10;
        const totalIopsPerSec = Math.round((totalIops / intervalSec) * 10) / 10;
        // Saturation bar (per second). 500/s recreated the very FP the gate
        // exists to suppress: the documented Docker-on-loopback-over-RAID burst
        // is ~26761 ops / 60s = ~446 IOPS/s, which sits JUST UNDER 500 and so
        // read as unsaturated -> critical (Codex 2026-07-18 #7). The bar must sit
        // below that busy-workload rate.
        //
        // 150/s is a PHYSICAL anchor, not an arbitrary gap midpoint: ~150 random
        // IOPS is about the native ceiling of a healthy 7200rpm SATA HDD, the
        // device class this rule primarily guards (SSD/NVMe run far faster and use
        // the low-latency thresholds above). At high latency, a device sustaining
        // MORE than a healthy HDD's own ceiling is being saturated by queued load
        // (benign: the ~446/s FP is QD~900, pure load); a device doing LESS is
        // underperforming itself, which is the slow/dying signal we must keep. So
        // the boundary lands where "busy" and "sick" physically separate. Operators
        // can still tune via disk_latency_saturation_iops.
        const SATURATION_IOPS = config.disk_latency_saturation_iops ?? 150; // per second
        const saturated = busyIopsPerSec >= SATURATION_IOPS;
        // Virtual / stacked block devices (loopback files, device-mapper
        // targets, md arrays, zram) are not physical drives: their latency
        // reflects the storage stack and its load, not a failing disk. This is
        // the Docker-on-loopback-over-md-RAID pattern on marketplace GPU hosts
        // (round 5). Classify as info so the signal stays visible without
        // paging, and so the rule need not be blanket-suppressed by the
        // marketplace_gpu profile: a genuine slow *physical* drive (nvme*/sd*)
        // still fires. Real drive health is covered by SMART on the backing
        // devices regardless.
        const isVirtual = /^(loop|dm-|md|zram|ram|nbd|drbd)\d/.test(dev.device);
        const isCritical = !saturated && !isVirtual && worstLat >= criticalMs;
        const severity: "critical" | "warning" | "info" =
          isVirtual || saturated
            ? "info"
            : isCritical
              ? "critical"
              : "warning";
        results.push({
          type: "disk_latency_high",
          severity,
          title: isVirtual
            ? `Disk /dev/${dev.device} latency ${worstLat.toFixed(1)}ms (virtual device)`
            : saturated
              ? `Disk /dev/${dev.device} latency ${worstLat.toFixed(1)}ms under load (${deviceClass})`
              : `Disk /dev/${dev.device} latency ${worstLat.toFixed(1)}ms (${deviceClass})`,
          message: isVirtual
            ? `/dev/${dev.device} avg ${which} latency ${worstLat.toFixed(1)}ms (${totalIopsPerSec} IOPS). This is a virtual/stacked block device (loopback, device-mapper, or md array), not a physical drive: its latency reflects the storage stack and its load, not disk health. Common on Docker-on-loopback-over-RAID hosts. Physical-drive health is covered by SMART on the backing nvme*/sd* devices.`
            : saturated
              ? `/dev/${dev.device} avg ${which} latency ${worstLat.toFixed(1)}ms during a heavy I/O burst (${busyIopsPerSec} ${which} IOPS). High latency under high throughput is I/O saturation, not a failing drive; act on it only if it correlates with smart_failing or rising SMART error counts.`
              : `/dev/${dev.device} avg ${which} latency ${worstLat.toFixed(1)}ms (${totalIopsPerSec} IOPS). ${isCritical ? `Severe I/O bottleneck (> ${criticalMs}ms ${deviceClass} threshold).` : `Elevated latency, drive may be struggling (> ${warningMs}ms ${deviceClass} threshold).`}`,
          evidence: {
            device: dev.device, avg_read_latency_ms: readLat, avg_write_latency_ms: writeLat,
            read_iops: dev.read_iops, write_iops: dev.write_iops,
            saturated,
            virtual: isVirtual,
            fix_commands: [
              `# Check SMART health for /dev/${dev.device}`,
              `sudo smartctl -a /dev/${dev.device}`,
              "",
              `# Check I/O scheduler`,
              `cat /sys/block/${dev.device}/queue/scheduler`,
              "",
              "# Check current I/O activity",
              "sudo iotop -oP -d 5 -n 3",
              "",
              "# Check if RAID rebuild is running",
              "cat /proc/mdstat",
            ],
          },
          recommendation: isVirtual
            ? `/dev/${dev.device} is a virtual/stacked device, not a physical disk, so there is no drive to replace. If throughput matters, look at the workload and the backing array; drive health is tracked by SMART on the backing nvme*/sd* devices.`
            : saturated
              ? `High latency on /dev/${dev.device} coincides with heavy I/O (${busyIops} ${which} IOPS), which points to saturation rather than a failing drive. On a marketplace/Docker host, container I/O on a loopback-backed array is the usual cause. Act only if it correlates with smart_failing or rising SMART errors.`
              : `High disk latency on /dev/${dev.device} indicates a struggling drive, saturated I/O queue, or RAID rebuild. Check SMART health and I/O scheduler.`,
        });
      }
      return results;
    },
  },

  // === Network (3) ===

  // 10. Interface errors
  //
  // Crucible 0.5.0+ sends per-interval deltas (not cumulative counters) for
  // errors and drops. Hardware errors (CRC, frame, carrier) fire on any
  // non-zero delta. Packet drops are gated by a threshold because firewalls
  // (ufw, iptables) generate routine drops on every internet-facing server.
  //
  // Evaluation uses three severity tiers (yellow / orange / red) with a
  // sustained-2-intervals requirement at the orange ratio threshold and a
  // minimum-traffic floor so idle ports don't trigger on a single error.
  // The logic needs the previous snapshot, so it lives in
  // evaluateInterfaceErrors() below and is called from the ingest path.
  // Bond masters are skipped; errors are evaluated per-slave.
  {
    type: "interface_errors",
    boot_grace_seconds: 120,
    evaluate() {
      // Stub: real logic is in evaluateInterfaceErrors() with previous-snapshot access.
      return [];
    },
  },

  // 11. Link speed mismatch
  //
  // Pre-C15: emits on any link below 1 Gbps.
  // C15 activation (2026-05-19): when snap.ethtool is present, fire
  // when current speed is below the highest advertised mode (i.e. the
  // NIC + driver advertised support for faster but the link
  // negotiated lower). On hosts without ethtool we fall back to the
  // legacy < 1 Gbps check.
  //
  // 2026-05-21: tighten C15 path to require a >=2x gap. The original
  // naive "any gap" check produced false positives on high-end multi-
  // mode NICs (e.g. Mellanox ConnectX advertises both 40 GbE and 56 GbE
  // Ethernet modes - operator-selected 40 G on a PCIe 3.0 x8 slot reads
  // as "downgraded" under the naive rule, but the user actually chose
  // 40 G deliberately for redundancy/PCIe headroom). The 2x threshold
  // preserves the real catches (1 Gbps NIC stuck at 100 Mbps = 10x;
  // 10 GbE stuck at 1 GbE = 10x) while skipping operator-choice and
  // PCIe-bound modes (40 -> 56 = 1.4x).
  {
    type: "link_speed_mismatch",
    evaluate(snap) {
      if (!snap.network) return [];
      const ethtoolByIface = new Map<string, string[]>();
      if (snap.ethtool?.available) {
        for (const e of snap.ethtool.interfaces) {
          ethtoolByIface.set(e.iface, e.advertised_link_modes);
        }
      }
      const results: AlertResult[] = [];
      for (const iface of snap.network) {
        if (!iface.speed_mbps) continue;
        const advertised = ethtoolByIface.get(iface.interface);
        if (advertised && advertised.length > 0) {
          // C15 path: highest advertised vs current. Require a >=2x gap.
          const maxAdvertisedMbps = highestAdvertisedSpeedMbps(advertised);
          if (maxAdvertisedMbps == null) continue;
          if (iface.speed_mbps >= maxAdvertisedMbps) continue;
          if (maxAdvertisedMbps < iface.speed_mbps * 2) continue;
          results.push({
            type: "link_speed_mismatch",
            severity: "warning",
            title: `${iface.interface} at ${iface.speed_mbps} Mbps (NIC supports up to ${maxAdvertisedMbps} Mbps)`,
            message: `Interface ${iface.interface} negotiated at ${iface.speed_mbps} Mbps but the NIC + driver advertise a mode up to ${maxAdvertisedMbps} Mbps. The gap is large enough to suggest an auto-negotiation issue or a downstream cap.`,
            evidence: {
              interface: iface.interface,
              speed_mbps: iface.speed_mbps,
              advertised_max_mbps: maxAdvertisedMbps,
              advertised_link_modes: advertised,
            },
            recommendation: `Check, in order: (1) switch-side port speed + cable rating (\`ethtool ${iface.interface}\` shows NIC-side advertised modes: cross-check vs the switch CLI; copper-vs-fiber mismatch and Cat5e on a 10 GbE port commonly downgrade); (2) PCIe slot bandwidth (a card in a PCIe x4 slot can't sustain its advertised max); (3) operator-chosen mode (Mellanox ConnectX cards expose 40/56 GbE modes; the lower mode may be intentional for redundancy or PCIe headroom). If the current speed is the deliberate config, mute the rule for this server.`,
          });
          continue;
        }
        // Legacy fallback: <1 Gbps is the signal when we have no
        // advertised-mode information.
        if (iface.speed_mbps >= 1000) continue;
        results.push({
          type: "link_speed_mismatch",
          severity: "warning",
          title: `${iface.interface} at ${iface.speed_mbps} Mbps`,
          message: `Interface ${iface.interface} negotiated at ${iface.speed_mbps} Mbps, below expected 1 Gbps minimum.`,
          evidence: { interface: iface.interface, speed_mbps: iface.speed_mbps },
          recommendation: "Check cable, SFP/transceiver, and switch port configuration. Try a different cable or port.",
        });
      }
      return results;
    },
  },

  // 12. Interface saturation
  {
    type: "interface_saturation",
    evaluate(snap, config) {
      if (!snap.network) return [];
      const threshold = (config.interface_utilization_percent ?? 90) / 100;
      const results: AlertResult[] = [];
      for (const iface of snap.network) {
        if (!iface.speed_mbps) continue;
        const maxBytesPerSec = (iface.speed_mbps * 1_000_000) / 8;
        const rxUtil = iface.rx_bytes_sec / maxBytesPerSec;
        const txUtil = iface.tx_bytes_sec / maxBytesPerSec;
        const maxUtil = Math.max(rxUtil, txUtil);
        if (maxUtil < threshold) continue;
        results.push({
          type: "interface_saturation",
          severity: "warning",
          title: `${iface.interface} at ${(maxUtil * 100).toFixed(0)}% utilization`,
          message: `Interface ${iface.interface} (${iface.speed_mbps} Mbps) is at ${(maxUtil * 100).toFixed(1)}% utilization.`,
          evidence: { interface: iface.interface, speed_mbps: iface.speed_mbps, rx_bytes_sec: iface.rx_bytes_sec, tx_bytes_sec: iface.tx_bytes_sec, utilization_percent: Math.round(maxUtil * 1000) / 10 },
          recommendation: "Check traffic patterns with `iftop` or `nload`. Consider bandwidth upgrade or traffic shaping.",
        });
      }
      return results;
    },
  },

  // 12b. Bond slave down
  {
    type: "bond_slave_down",
    boot_grace_seconds: 60,
    evaluate(snap) {
      if (!snap.network) return [];
      const results: AlertResult[] = [];
      for (const iface of snap.network) {
        if (!iface.bond_master || iface.operstate !== "down") continue;
        results.push({
          type: "bond_slave_down",
          severity: "critical",
          title: `Bond slave ${iface.interface} is down (${iface.bond_master})`,
          message: `Interface ${iface.interface}, a slave of ${iface.bond_master}, has MII status down. The bond is running with reduced redundancy.`,
          evidence: {
            interface: iface.interface,
            bond: iface.bond_master,
            operstate: iface.operstate,
            fix_commands: [
              `# Check bond status`,
              `cat /proc/net/bonding/${iface.bond_master}`,
              "",
              `# Check the slave interface`,
              `ip link show ${iface.interface}`,
              `ethtool ${iface.interface}`,
              "",
              `# Bring the slave back up`,
              `sudo ip link set ${iface.interface} up`,
              "",
              `# If the interface won't come up, check the cable and switch port`,
              `sudo ethtool -t ${iface.interface}`,
              `dmesg -T | grep -i "${iface.interface}" | tail -10`,
            ],
          },
          recommendation: `Bond slave ${iface.interface} is down. This reduces network redundancy on ${iface.bond_master}. Check the physical connection (cable, SFP, switch port) and bring the interface back up. If the interface flaps repeatedly, the NIC or cable may need replacement.`,
        });
      }
      return results;
    },
  },

  // 12c. LACP partner lost (C8 activation 2026-05-19).
  //
  // Bond MII is up but the LACP partner is unsynchronized
  // (synchronization bit cleared in the partner port-state bitfield).
  // bond_slave_down handles the MII-down case; this rule covers the
  // protocol-level failure that MII state doesn't surface.
  //
  // Also emits an info-level signal when the active aggregator has
  // fewer ports active than configured (silent redundancy loss).
  //
  // Capability gate: snap.bonding.available + at least one is_lacp bond.
  {
    type: "lacp_partner_lost",
    boot_grace_seconds: 120,
    evaluate(snap) {
      if (!snap.bonding?.available || snap.bonding.bonds.length === 0) return [];
      const results: AlertResult[] = [];
      for (const bond of snap.bonding.bonds) {
        if (!bond.is_lacp) continue;
        for (const slave of bond.slaves) {
          if (slave.mii_status !== "up") continue; // bond_slave_down handles MII-down
          if (slave.partner_lacp_synchronized === false) {
            results.push({
              type: "lacp_partner_lost",
              severity: "critical",
              title: `LACP partner lost on ${bond.name}/${slave.name}`,
              message: `Bond ${bond.name} slave ${slave.name} is link-layer up (MII), but the LACP partner is unsynchronized (port state 0x${(slave.partner_lacp_port_state ?? 0).toString(16)}). The bond appears functional via link layer while the protocol is broken: traffic on this slave may be dropped by the switch.`,
              evidence: {
                bond_name: bond.name,
                slave_name: slave.name,
                mii_status: "up",
                partner_lacp_port_state: slave.partner_lacp_port_state,
                partner_lacp_synchronized: false,
                partner_churn_state: slave.partner_churn_state,
                link_failure_count: slave.link_failure_count,
              },
              recommendation: `LACP partner not synchronized on ${slave.name}. Check switch-side LACP config (rate fast vs slow), port-channel mode, system priority, and whether the partner port is in the right LAG. \`cat /proc/net/bonding/${bond.name}\` shows the partner key + system MAC the switch reports; if those don't match expected, the switch port may be in the wrong LAG.`,
            });
          }
        }
        // Aggregator shortfall: active ports < configured ports.
        if (bond.active_aggregator) {
          const shortfall =
            bond.configured_port_count - bond.active_aggregator.number_of_ports;
          if (shortfall > 0) {
            results.push({
              type: "lacp_partner_lost",
              severity: "warning",
              title: `LACP bond ${bond.name}: ${shortfall} port(s) inactive`,
              message: `Bond ${bond.name} has ${bond.configured_port_count} configured ports but the active aggregator only includes ${bond.active_aggregator.number_of_ports}. ${shortfall} port(s) are not contributing to the bond: redundancy is reduced.`,
              evidence: {
                bond_name: bond.name,
                configured_port_count: bond.configured_port_count,
                active_port_count: bond.active_aggregator.number_of_ports,
                shortfall,
              },
              recommendation: `One or more bond ports aren't joining the aggregator. Typical causes: LACP timeout on one slave (covered by per-slave emission above), aggregator key mismatch with switch, or a slave with MII up but no LACP PDUs (cable to wrong switch port). Inspect with \`cat /proc/net/bonding/${bond.name}\`.`,
            });
            break; // One aggregator-shortfall emission per bond.
          }
        }
      }
      return results;
    },
  },

  // 12d. TCP retransmit rate high (C10 activation 2026-05-19).
  //
  // Per pattern library Cat 4 (Network) + OneUptime engineering guide
  // March 2026: retransmission ratio above 1% starts impacting
  // performance; above 5% degrades throughput significantly. Default
  // threshold 2% with the per-snapshot ratio as a signal (the Crucible
  // agent computes ratio over the snapshot interval - typically 60s).
  //
  // Subordinate to bond_slave_down (hardware-layer cause dominates).
  // Participates in accept_backlog_or_syn_flood incident group.
  // Capability-gated on snap.tcp_stats.retrans_ratio.
  //
  // Low-traffic gate (2026-05-22): empirically validated that on idle
  // val hosts, a 60s snapshot interval routinely sends <100 segments;
  // 4 retransmits in that window produces an "8% ratio" that is
  // statistical noise rather than a real network fault. Under sustained
  // iperf3 load (5 min, 9.37 Gbit/s), the same fleet hosts measured
  // 0.000% to 0.147% retrans ratio. So we additionally gate on
  // retrans_rate_per_sec >= 1.0 (60+ retransmits per minute sustained)
  // before firing. This keeps real high-traffic problems firing
  // (any production host losing 1+ packet/sec to retrans is genuinely
  // degraded) while suppressing the small-denominator noise on quiet
  // hosts. See PR for the iperf3 measurement details.
  {
    type: "tcp_retrans_high",
    boot_grace_seconds: 300, // need at least two snapshots for a non-null ratio
    evaluate(snap, config) {
      const stats = snap.tcp_stats;
      if (!stats?.available) return [];
      const ratio = stats.retrans_ratio;
      if (ratio == null) return []; // first snapshot or counter reset
      const threshold = 0.02;
      if (ratio <= threshold) return [];

      // Low-traffic suppression: if the absolute retransmit rate is
      // below 1.0/sec, the ratio is small-denominator noise. See block
      // comment above the rule. retrans_rate_per_sec is null on the
      // first snapshot after boot or after a counter reset - treat
      // null as "not enough information to fire."
      const ratePerSec = stats.retrans_rate_per_sec;
      const minRatePerSec = 1.0;
      if (ratePerSec == null || ratePerSec < minRatePerSec) return [];

      // Volume gate (2026-06-07): the ratio is only statistically meaningful
      // when the host sends a non-trivial number of segments. The flat 1/sec
      // retrans floor above does NOT scale with the ratio: a quiet host (e.g.
      // an idle services box making a few outbound API calls) can pass it at a
      // 20% ratio off ~5 retransmits/sec. The implied out-segment rate is
      // retrans_rate / ratio; require >= 500/sec (config override
      // tcp_retrans_min_out_segs_rate) so the denominator is large enough that
      // the ratio reflects throughput-relevant loss, not noise. The original
      // 50/sec floor was too low: it sat inside a quiet services box's own
      // baseline (the production host measured ~107 out-segs/sec at idle,
      // 2026-07-01), so quiet-moment retransmit bursts kept firing 2-11%
      // ratios. Below ~500 segs/sec (~6 Mbit/s) a retransmit ratio does not
      // materially degrade throughput. ratio > 0.02 here so the division is safe.
      const outSegsRatePerSec = ratePerSec / ratio;
      const minOutSegsRatePerSec = config.tcp_retrans_min_out_segs_rate ?? 500;
      if (outSegsRatePerSec < minOutSegsRatePerSec) return [];

      const pct = (ratio * 100).toFixed(2);
      return [{
        type: "tcp_retrans_high",
        severity: "warning",
        title: `TCP retransmit ratio ${pct}%`,
        message: `TCP retransmits at ${pct}% of segments sent over the most recent snapshot interval (${ratePerSec.toFixed(1)} retrans/sec). Above ${(threshold * 100).toFixed(0)}% suggests network reliability or remote-peer issues; above 5% materially degrades throughput.`,
        evidence: {
          retrans_ratio: ratio,
          retrans_ratio_percent: Number(pct),
          retrans_segs_total: stats.retrans_segs_total,
          out_segs_total: stats.out_segs_total,
          retrans_rate_per_sec: ratePerSec,
          out_segs_rate_per_sec: Number(outSegsRatePerSec.toFixed(1)),
          threshold_percent: threshold * 100,
          min_rate_per_sec_gate: minRatePerSec,
          min_out_segs_rate_gate: minOutSegsRatePerSec,
        },
        recommendation: `High retransmit rate is upstream of the local host. Test peer reachability with \`mtr <peer>\` and capture packet loss along the path. If the host is a network function (proxy, gateway), the upstream link may be saturated; check interface_saturation. If only specific peers retransmit, it's a peer-side fault. If broad, suspect local NIC errors (already covered by interface_errors).`,
      }];
    },
  },

  // 12e. Listen overflow (C10 activation 2026-05-19).
  //
  // /proc/net/netstat TcpExt ListenOverflows + ListenDrops indicate the
  // kernel is dropping connections at accept-queue level. Two separate
  // counters; we gate each one differently because they mean different
  // things at the kernel level:
  //
  //   ListenOverflows: accept queue was full when a SYN-ACK landed.
  //     Subset of ListenDrops. Genuinely actionable: app can't accept()
  //     fast enough OR somaxconn is too small. Fire on ANY non-zero rate.
  //
  //   ListenDrops: total SYNs dropped at the listen socket for any
  //     reason (overflows + ENOMEM-class drops + a few weirder paths).
  //     Always >= overflows. Healthy hosts see sporadic drops at very
  //     low rates from long-tail SYN scans / brief OOM moments / TCP
  //     state machine corner cases. Need a minimum rate to fire - same
  //     reasoning as tcp_retrans_high.
  //
  // 2026-05-23 noise-fix: pre-fix the rule fired on `dropsRate > 0`
  // which paged P2 alerts displayed as "ListenDrops 0.00/s" because
  // 0.0033/s rounds to 0.00 in the toFixed(2) format. Steady-state
  // 1-drop-per-5-min on a host with `overflows = 0` is not paging-
  // worthy.
  //
  // Gates:
  //   overflowsRate > 0           -> fire (rare, specific, actionable)
  //   dropsRate >= 1.0 (60/min)   -> fire (real backlog pressure)
  //   anything below              -> no-fire
  //
  // 2026-06-07 low-traffic raise: the drops floor was 0.1/sec (6/min), which
  // still paged on quiet hosts (e.g. services) seeing 0.12-0.18/s of long-tail
  // SYN-scan / transient drops with overflows = 0. Raised to 1.0/sec (60/min)
  // so only a genuinely sustained backlog drop fires; real accept-queue
  // saturation still surfaces immediately via the overflows counter (any rate).
  //
  // Subordinate to bond_slave_down. Participates in
  // accept_backlog_or_syn_flood incident group.
  // Capability-gated on snap.tcp_stats.listen_overflows_rate_per_sec.
  {
    type: "listen_overflow",
    boot_grace_seconds: 300,
    evaluate(snap) {
      const stats = snap.tcp_stats;
      if (!stats?.available) return [];
      const overflowsRate = stats.listen_overflows_rate_per_sec;
      const dropsRate = stats.listen_drops_rate_per_sec;
      if (overflowsRate == null && dropsRate == null) return []; // first snapshot
      const minDropsRate = 1.0; // 60/min; below this is kernel-noise on quiet hosts
      const overflowsFired = overflowsRate != null && overflowsRate > 0;
      const dropsFired = dropsRate != null && dropsRate >= minDropsRate;
      if (!overflowsFired && !dropsFired) return [];
      const pieces: string[] = [];
      if (overflowsFired) {
        pieces.push(`ListenOverflows ${overflowsRate!.toFixed(2)}/s`);
      }
      if (dropsFired) {
        pieces.push(`ListenDrops ${dropsRate!.toFixed(2)}/s`);
      }
      return [{
        type: "listen_overflow",
        severity: "warning",
        title: `TCP listen-queue dropping connections: ${pieces.join(", ")}`,
        message: `The kernel is dropping connections at the accept queue: ${pieces.join(" + ")}. Either the application accept() loop can't keep up with arriving connections, or net.core.somaxconn / the application's listen(2) backlog is too small.`,
        evidence: {
          listen_overflows_total: stats.listen_overflows_total,
          listen_overflows_rate_per_sec: overflowsRate,
          listen_drops_total: stats.listen_drops_total,
          listen_drops_rate_per_sec: dropsRate,
        },
        recommendation: `Identify the listener with backlog pressure via \`ss -lt\` (Recv-Q is current backlog; Send-Q is the configured backlog limit). If the app is the bottleneck, increase its accept() concurrency. If the kernel limit is tight: \`sysctl net.core.somaxconn\` and raise it (typical 1024 -> 8192). Application also needs to pass an appropriate backlog argument to listen(2).`,
      }];
    },
  },

  // === Hardware/IPMI (5) ===

  // 13. CPU temperature high.
  //
  // Thresholds are derived per-sensor from the BMC's reported
  // `upper_critical`: warning = uc - 15, critical = uc - 5. Falls back to
  // the config-configured absolute thresholds (default 80 / 90 C) when
  // the BMC does not report upper_critical. Each CPU sensor on a
  // multi-socket server is evaluated independently against its own uc.
  //
  // Sensors are first filtered to Temperature type only, because names
  // like "CPU_VDDCR0" (a voltage rail) match the "cpu" name-substring
  // check but are voltage sensors with an upper_critical in volts. Before
  // this filter, the rule would subtract 5 from a 1.578 V upper_critical
  // and fire "critical" on any reading above -3.4 V.
  {
    type: "cpu_temperature_high",
    boot_grace_seconds: 60,
    evaluate(snap, config) {
      const fallbackWarning = config.cpu_temp_warning_c ?? 80;
      const fallbackCritical = config.cpu_temp_critical_c ?? 90;

      // R-P2-1 (val-fleet campaign 2026-05-29): correlate a high CPU
      // temperature with current CPU utilization. The default verdict
      // for this rule is `vendor-side` (cooling fault), but the campaign
      // caught the rule mislabelling a load-induced spike: our own
      // cpu_pressure_high induction (stress-ng --cpu 64) drove a Ryzen
      // 5950X to 81.3°C and fired this rule with "check fan / airflow /
      // dust / thermal paste", when the heat was 100% workload-caused.
      // When utilization is at/above LOAD_CORRELATION_THRESHOLD we keep
      // the alert (sustained high-temp-under-load can still cook a
      // marginally-cooled chip; do NOT suppress and do NOT downgrade
      // severity) but reframe the message + remediation to a
      // load-correlated "investigate cooling only if temp stays high
      // after load drops" framing, and flip the at-a-glance verdict from
      // vendor-side to investigation via an evidence override that the
      // FIX resolver honours. V1 uses the current snapshot's utilization;
      // a cross_snapshot window (to catch temp climbing while load was
      // already steady) is deferred to V2.
      const LOAD_CORRELATION_THRESHOLD = 70;
      const VENDOR_SIDE_RECO =
        "Check cooling system: fan operation, airflow, ambient temperature. Clean dust if applicable. Check thermal paste on CPU.";
      const cpuUsage =
        snap.cpu && typeof snap.cpu.idle_percent === "number" && Number.isFinite(snap.cpu.idle_percent)
          ? Math.round((100 - snap.cpu.idle_percent) * 10) / 10
          : null;
      const loadCorrelated = cpuUsage !== null && cpuUsage >= LOAD_CORRELATION_THRESHOLD;
      // Returns the message / recommendation / evidence augmentation for
      // a temperature alert, branching on load correlation. Shared by the
      // hwmon and IPMI emit paths so both stay in lockstep.
      const loadFields = (baseMessage: string) =>
        loadCorrelated
          ? {
              message: `${baseMessage} CPU utilization is ${cpuUsage}%, so this temperature tracks workload rather than a cooling fault; investigate cooling only if it stays high after load drops.`,
              recommendation: `Temperature is correlated with high CPU load (${cpuUsage}% utilization). Confirm the workload is expected; if so, no cooling action is required. Investigate cooling (fan operation, airflow, ambient temperature, dust, thermal paste) only if the temperature stays high after load returns to normal.`,
              extraEvidence: { cpu_utilization: cpuUsage, load_correlated: true, verdict_prior_override: "investigation" },
            }
          : {
              message: baseMessage,
              recommendation: `${VENDOR_SIDE_RECO} ${OWNERSHIP_REMEDIATION_NOTE}`,
              extraEvidence: { cpu_utilization: cpuUsage, load_correlated: false },
            };

      // Phase 3 A.2: hwmon-primary path. snap.thermal.max_cpu_celsius
      // (Crucible 0.8.0+) is the preferred signal because hwmon is more
      // accurate, sensor naming is standardised by the CPU vendor, and
      // it works on hosts without a BMC (Pi, hypervisors, containers).
      // IPMI is the fallback.
      const hwmonRaw = snap.thermal?.max_cpu_celsius;
      const hwmonValue =
        typeof hwmonRaw === "number" && Number.isFinite(hwmonRaw)
          ? hwmonRaw
          : null;

      if (hwmonValue !== null) {
        const round1 = (n: number) => Number(n.toFixed(1));
        const valueDisp = round1(hwmonValue);
        const warningDisp = round1(fallbackWarning);
        const criticalDisp = round1(fallbackCritical);
        const sourceLabel = snap.thermal?.source || "hwmon";
        const isHot = hwmonValue >= fallbackWarning;
        const isCritical = hwmonValue >= fallbackCritical;

        // Always log path attribution - useful even when no alert fires,
        // for synthesis ("how often is hwmon vs IPMI used in the field?").
        console.log(
          `[cpu_temperature_high] path=hwmon source="${sourceLabel}" value=${valueDisp}°C warning=${warningDisp}°C critical=${criticalDisp}°C fired=${isHot}`,
        );

        if (!isHot) return [];

        const baseMessage = isCritical
          ? `CPU thermal reading ${valueDisp}°C from hwmon (${sourceLabel}). Above critical threshold (${criticalDisp}°C).`
          : `CPU thermal reading ${valueDisp}°C from hwmon (${sourceLabel}). Above warning threshold (${warningDisp}°C).`;
        const lc = loadFields(baseMessage);

        return [{
          type: "cpu_temperature_high",
          severity: isCritical ? "critical" : "warning",
          title: `CPU thermal: ${valueDisp}°C`,
          message: lc.message,
          evidence: {
            path: "hwmon",
            source: sourceLabel,
            value: hwmonValue,
            unit: "°C",
            warning_threshold: fallbackWarning,
            critical_threshold: fallbackCritical,
            threshold_source: "config_or_default",
            ...lc.extraEvidence,
          },
          recommendation: lc.recommendation,
        }];
      }

      // Fallback path: IPMI. Existing logic unchanged except for the
      // path: "ipmi" tag in evidence and a console.log on entry/empty.
      if (!snap.ipmi?.available || !snap.ipmi.sensors) {
        console.log(
          `[cpu_temperature_high] path=none reason="no hwmon thermal value and no IPMI sensors"`,
        );
        return [];
      }
      const results: AlertResult[] = [];
      for (const sensor of snap.ipmi.sensors) {
        // (1) Gate by sensor type. Prefer BMC-reported type; fall back to
        // unit string for BMCs that don't expose type cleanly.
        if (!isTemperatureSensor(sensor)) continue;

        const name = sensor.name.toLowerCase();
        // Must contain cpu or processor; exclude ambient / chassis / PCH /
        // PSU / DIMM / memory sensors that may include "temp" in their name.
        const isCpu = name.includes("cpu") || name.includes("processor");
        const isExcluded = ["ambient", "system", "pch", "inlet", "outlet", "exhaust", "psu", "dimm", "memory"].some((w) => name.includes(w));
        if (!isCpu || isExcluded) continue;
        const value = typeof sensor.value === "number" ? sensor.value : parseFloat(String(sensor.value));
        if (isNaN(value)) continue;

        const ucRaw = sensor.upper_critical;
        const ucValid =
          typeof ucRaw === "number" && Number.isFinite(ucRaw) && ucRaw > 0;
        const warningRaw = ucValid ? (ucRaw as number) - 15 : fallbackWarning;
        const criticalRaw = ucValid ? (ucRaw as number) - 5 : fallbackCritical;

        if (value < warningRaw) continue;
        const isCritical = value >= criticalRaw;

        // (2) Read unit from the sensor itself. The rule is temperature-only
        // so it will be a temperature unit in practice, but don't hardcode.
        const unit = sensor.unit || "°C";
        // Normalise displayed unit: BMCs emit "degrees C" or "C"; prefer "°C".
        const unitDisplay = /degrees\s*c/i.test(unit) || unit.trim() === "C" ? "°C" : unit;

        // (3) Round for display; the raw numbers go into evidence unrounded.
        const round1 = (n: number) => Number(n.toFixed(1));
        const valueDisp = round1(value);
        const warningDisp = round1(warningRaw);
        const criticalDisp = round1(criticalRaw);
        const ucDisp = ucValid ? round1(ucRaw as number) : null;

        const derivation = ucValid
          ? `derived from BMC limit of ${ucDisp}${unitDisplay}`
          : "fallback threshold; BMC did not report upper_critical";

        console.log(
          `[cpu_temperature_high] path=ipmi sensor="${sensor.name}" value=${valueDisp}${unitDisplay} warning=${warningDisp}${unitDisplay} critical=${criticalDisp}${unitDisplay} fired=true`,
        );

        const baseMessage = isCritical
          ? `${sensor.name} is at ${valueDisp}${unitDisplay}. Above critical threshold (${criticalDisp}${unitDisplay}, ${derivation}).`
          : `${sensor.name} is at ${valueDisp}${unitDisplay}. Above warning threshold (${warningDisp}${unitDisplay}, ${derivation}).`;
        const lc = loadFields(baseMessage);

        results.push({
          type: "cpu_temperature_high",
          severity: isCritical ? "critical" : "warning",
          title: `${sensor.name}: ${valueDisp}${unitDisplay}`,
          message: lc.message,
          evidence: {
            path: "ipmi",
            sensor: sensor.name,
            value,
            unit,
            upper_critical_bmc: ucValid ? ucRaw : null,
            warning_threshold: warningRaw,
            critical_threshold: criticalRaw,
            threshold_source: ucValid ? "bmc_derived" : "fallback",
            ...lc.extraEvidence,
          },
          recommendation: lc.recommendation,
        });
      }
      // If we walked the IPMI sensors and matched none, log path=none for
      // synthesis. The evaluator returns [] either way; the log is just
      // an observability hook.
      if (results.length === 0) {
        console.log(
          `[cpu_temperature_high] path=none reason="hwmon absent; IPMI sensors present but no matching CPU temperature sensor" ipmi_sensor_count=${snap.ipmi.sensors.length}`,
        );
      }
      return results;
    },
  },

  // 14. ECC memory errors. Two-tier evaluation:
  //
  // - Uncorrectable: any non-zero count fires critical immediately,
  //   no rate gating. Synchronous in-snapshot path below.
  // - Correctable: rate-based over a rolling window (default 24h)
  //   because BMC counters are cumulative-since-last-clear; a static
  //   threshold misbehaves on long-running hosts. Cross-snapshot
  //   lookup lives in evaluateEccErrors() at the bottom of this
  //   file (glassmkr#24).
  //
  // Reads max(named-sensor counter, SEL-derived counter) so Dell /
  // HPE iDRAC hosts (ECC via SEL) and Supermicro / ASRock hosts (ECC
  // via named sensors) are covered by the same rule. Crucible 0.8.0+
  // populates both fields; older agents populate only the named
  // counter.
  {
    type: "ecc_errors",
    // BMC ECC counters often aren't stable until the BMC has finished
    // its own POST sequence; suppress for 2 minutes after host boot.
    // Same value as interface_errors, cpu_temperature_high.
    boot_grace_seconds: 120,
    evaluate(snap) {
      // C1 activation (2026-05-19): when EDAC is present (Crucible
      // v0.10.4+), prefer it as the primary signal - it sits closer
      // to hardware than IPMI SEL. Fall back to IPMI when EDAC absent.
      const edacUnc = snap.ecc_edac?.edac_uncorrected_total ?? 0;
      const edacCorr = snap.ecc_edac?.edac_corrected_total ?? 0;
      const namedUnc = sanitizeCount(snap.ipmi?.ecc_errors?.uncorrectable);
      const selUnc = sanitizeCount(snap.ipmi?.ecc_errors_from_sel?.uncorrectable);
      const namedCorr = sanitizeCount(snap.ipmi?.ecc_errors?.correctable);
      const selCorr = sanitizeCount(snap.ipmi?.ecc_errors_from_sel?.correctable);

      // Reconciliation: when both sources report, prefer EDAC for the
      // counter value (closer to hardware) and tag the source on
      // evidence so customers see which path produced the alert.
      const maxUnc = Math.max(edacUnc, namedUnc, selUnc);
      if (maxUnc <= 0) return [];

      const source = snap.ecc_edac
        ? (edacUnc > 0 ? "edac" : "ipmi_sel_fallback")
        : "ipmi_sel";
      const path = derivePath(namedCorr + namedUnc, selCorr + selUnc);
      const evidence = {
        max_uncorrectable: maxUnc,
        source,
        edac: snap.ecc_edac
          ? {
              correctable: edacCorr,
              uncorrectable: edacUnc,
              dimms_with_errors: (snap.ecc_edac.dimms ?? []).filter((d) => d.ue_count > 0 || d.ce_count > 0),
            }
          : null,
        named: { correctable: namedCorr, uncorrectable: namedUnc },
        sel: {
          correctable: selCorr,
          uncorrectable: selUnc,
          newest_event_timestamp: snap.ipmi?.ecc_errors_from_sel?.newest_event_timestamp ?? null,
        },
        path,
        evaluation: "uncorrectable_immediate" as const,
      };
      return [{
        type: "ecc_errors",
        severity: "critical",
        title: `${maxUnc} uncorrectable ECC error(s)`,
        message: `Uncorrectable memory errors detected (source: ${source}). Data corruption is possible. This DIMM is failing.`,
        evidence,
        recommendation: (source === "edac"
          ? "Replace the affected DIMM immediately. Run `ras-mc-ctl --summary` to identify the slot from EDAC; cross-reference with IPMI SEL."
          : "Replace the affected DIMM immediately. Run `ipmitool sdr type Memory` to identify the slot. Schedule emergency maintenance.")
          + " " + OWNERSHIP_REMEDIATION_NOTE,
      }];
    },
  },

  // 15. PSU redundancy loss. Two-tier evaluation:
  //
  // Tier 1 (aggregate): Crucible 0.8.0+ extracts the Dell `PS Redundancy`
  // sensor into a typed enum at the agent layer. When present, that's the
  // most authoritative signal the BMC offers - fire/no-fire decisions
  // come from it directly, regardless of per-PSU sensor noise.
  //
  // Tier 2 (per-PSU): when the aggregate field is undefined or "unknown"
  // (no Dell aggregate, or Crucible couldn't classify it), fall back to
  // iterating named PSU sensors. The iteration handles Supermicro / ASRock
  // / generic ("psu", "power supply") and Dell-style PS<N> patterns.
  //
  // Path attribution captured on every branch so post-hoc synthesis can
  // analyse the rule's decision distribution.
  //
  // Known false-negative gap (filed as Phase 7 P2 #29): discrete sensors
  // that encode fault states as hex bitmasks (per IPMI 2.0 Table 42-3
  // entry 0x08) are not decoded - they fall through to the default
  // healthy branch. Fix is queued for a Crucible-side normalisation
  // workstream (kickoff Shape C) and is out of scope for A.4.
  {
    type: "psu_redundancy_loss",
    evaluate(snap) {
      // Always log path attribution at the end (mirrors A.2's pattern),
      // including no-fire branches, so synthesis can analyse the rule's
      // decision distribution. Built up as we go and emitted once.
      const logPath = (path: string, fired: boolean, extra: Record<string, unknown> = {}) => {
        const extras = Object.entries(extra).map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`).join(" ");
        console.log(`[psu_redundancy_loss] path=${path} fired=${fired}${extras ? " " + extras : ""}`);
      };

      if (!snap.ipmi?.available || !snap.ipmi.sensors) {
        logPath("none", false, { reason: "ipmi-unavailable" });
        return [];
      }

      // Tier 1: aggregate redundancy signal from Crucible's vendor
      // classifier (currently Dell-only). Authoritative when present.
      const aggregate = snap.ipmi.psu_redundancy_state;
      if (aggregate === "redundancy_lost") {
        logPath("aggregate-redundancy", true, { state: "redundancy_lost", severity: "critical" });
        return [{
          type: "psu_redundancy_loss",
          severity: "critical",
          title: `PSU redundancy lost`,
          // Report the BMC's verdict, not a cause. The aggregate sensor says only
          // that redundancy is gone; it does not say why, and the two reasons need
          // opposite fixes. HPE documents that chassis draw exceeding what one
          // supply can carry raises the SAME redundancy-lost condition as a failed
          // unit or feed, so "replace the failed PSU" is a guess that sends an
          // operator hunting for hardware damage that may not exist. Only the Tier 2
          // per-PSU path below has the evidence to name a specific failed unit.
          message: `BMC reports redundancy_lost on the aggregate PS Redundancy sensor. The chassis is no longer redundant. The BMC does not report which cause applies: either a supply or its feed has failed, or total draw has grown past what the remaining supplies can carry.`,
          evidence: { aggregate_state: aggregate, path: "aggregate-redundancy" },
          recommendation: `Check each PSU's individual status and input before ordering hardware. A unit reporting not-ok or absent means a failed supply or feed; all units reporting ok points instead at load exceeding redundant capacity, where the fix is reducing draw or adding capacity rather than replacing anything. Either way the server no longer survives a single power supply failure. ${OWNERSHIP_REMEDIATION_NOTE}`,
        }];
      }
      if (aggregate === "redundancy_degraded") {
        logPath("aggregate-redundancy", true, { state: "redundancy_degraded", severity: "warning" });
        return [{
          type: "psu_redundancy_loss",
          severity: "warning",
          title: `PSU redundancy degraded`,
          message: `BMC reports redundancy_degraded on the aggregate PS Redundancy sensor. Power supply configuration is operating below intended redundancy level.`,
          evidence: { aggregate_state: aggregate, path: "aggregate-redundancy" },
          recommendation: `Inspect each PSU's individual status. The BMC sees a degradation that hasn't yet escalated to full redundancy loss. ${OWNERSHIP_REMEDIATION_NOTE}`,
        }];
      }
      if (aggregate === "fully_redundant") {
        // Aggregate present and healthy: trust the BMC's authoritative
        // signal and skip per-PSU iteration. No alert emitted.
        logPath("aggregate-redundancy", false, { state: "fully_redundant" });
        return [];
      }
      // aggregate === "unknown" or undefined: fall through to per-PSU
      // logic. Both mean "no usable aggregate signal" - for "unknown"
      // Crucible saw the sensor but couldn't classify; for undefined
      // the sensor wasn't present (most non-Dell BMCs).

      // Tier 2: per-PSU iteration.
      const psuSensors = snap.ipmi.sensors.filter((s) => {
        const name = s.name.toLowerCase();
        // Match PSU/PS-prefix/power supply. The \b-like check avoids matching
        // unrelated sensors whose names happen to contain "ps" as a substring.
        return name.includes("psu") || /\bps\d/.test(name) || name.includes("power supply");
      });

      if (psuSensors.length === 0) {
        logPath("none", false, { reason: "no-psu-sensors-matched" });
        return [];
      }
      if (psuSensors.length < 2) {
        // Single PSU: redundancy isn't possible, so loss isn't either.
        logPath("single-psu", false, { psu_count: psuSensors.length });
        return [];
      }

      // Classify each PSU as fault / ok / discrete-status-ok. The
      // discrete-status-ok bucket exists for sensors that report state
      // as a hex bitmask (`status` like "0x0080") - the rule treats
      // them as healthy by default since the false-positive bug
      // (parseFloat("0x0100") === 0 matching value === "0") was
      // closed. Positive fault detection on these sensors is the
      // discrete-bitmask gap tracked separately as #29.
      const failedPsus: typeof psuSensors = [];
      let anyDiscreteOk = false;
      let anyLiteralOk = false;
      for (const s of psuSensors) {
        const status = String(s.status).toLowerCase();
        const value = String(s.value).toLowerCase();
        const unit = String(s.unit).toLowerCase();
        if (status === "ok") {
          anyLiteralOk = true;
          continue;
        }
        const isFault = status === "cr" || status === "nr" ||
                        status.includes("fail") || status.includes("absent") ||
                        value.includes("fail") || value.includes("absent");
        if (isFault) {
          failedPsus.push(s);
          continue;
        }
        // Not literal "ok", not matching a fault pattern. Most likely a
        // discrete sensor with a hex-bitmask status field.
        if (unit === "discrete" || /^0x[0-9a-f]+$/.test(status)) {
          anyDiscreteOk = true;
        } else {
          // Unknown shape - treat as healthy by default to avoid false
          // positives on vendors / firmware variants we haven't
          // characterised.
          anyLiteralOk = true;
        }
      }

      if (failedPsus.length > 0) {
        logPath("per-psu-fault", true, { failed_count: failedPsus.length, total_psus: psuSensors.length });
        return [{
          type: "psu_redundancy_loss",
          severity: "critical",
          title: `PSU redundancy lost`,
          message: `${failedPsus.length} PSU(s) in fault/absent state: ${failedPsus.map((p) => p.name).join(", ")}. Server is running without power redundancy.`,
          evidence: {
            failed: failedPsus.map((p) => ({ name: p.name, status: p.status, value: p.value })),
            total_psus: psuSensors.length,
            path: "per-psu-fault",
          },
          recommendation: `Check PSU status, replace failed unit, verify power connections. Server is vulnerable to power supply failure. ${OWNERSHIP_REMEDIATION_NOTE}`,
        }];
      }

      // No fault, no fire. Distinguish all-literally-"ok" vs. at-least-
      // one-discrete-hex-bitmask-treated-as-healthy. The latter has the
      // false-negative gap from #29; synthesis can use the path tag to
      // see how often we're relying on default-healthy interpretation
      // versus a clear "ok" signal from the BMC.
      const path = anyDiscreteOk && !anyLiteralOk ? "discrete-status-ok"
                 : anyDiscreteOk ? "discrete-status-ok"  // mixed → still surface the looser signal
                 : "all-healthy";
      logPath(path, false, { total_psus: psuSensors.length });
      return [];
    },
  },

  // 16. IPMI SEL critical events
  //
  // Time-windowed: only events that fall within the last
  // `ipmi_sel_critical_window_days` (default 30) count. Pre-fix the
  // rule fired on ALL critical-asserted events in the SEL, so a
  // paired Asserted/Deasserted Power Supply event from a year ago
  // would keep the alert lit forever until the operator manually
  // ran `ipmitool sel clear`. The window converts the rule from
  // "what hardware has ever misbehaved" to "what hardware is
  // misbehaving recently". Per-server override via
  // `config_overrides.ipmi_sel_critical_window_days`. Codex
  // experiment 2026-05-12 P2.
  //
  // Timestamp parsing is best-effort: Crucible emits ipmitool's raw
  // date string ("YY-MM-DD HH:MM:SS UTC"-ish) which is not strict
  // ISO-8601. Parse failures are fail-open: events with
  // unparseable timestamps are INCLUDED in the window (treated as
  // "unknown age, possibly recent"). Once Crucible normalises the
  // emission, fail-open becomes a no-op.
  {
    type: "ipmi_sel_critical",
    boot_grace_seconds: 30,
    evaluate(snap, config) {
      if (!snap.ipmi?.available || !snap.ipmi.sel_events_recent?.length) return [];

      const windowDays =
        typeof config.ipmi_sel_critical_window_days === "number" && config.ipmi_sel_critical_window_days > 0
          ? Math.floor(config.ipmi_sel_critical_window_days)
          : 30;
      const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

      // 2026-05-24 transient-pairing noise-fix. Pre-fix, the rule filtered
      // only `direction === "Asserted"` and ignored the matching
      // `Deasserted` companion. A BMC bus glitch on mz62hd produced four
      // simultaneous events at 02:47:17 (INLET_TEMP "Lower Non-critical
      // going low" + "Lower Critical going low" both Asserted, PS1/PS2
      // "Presence detected" both Deasserted), then deasserted them all
      // within one second as sensors returned to normal. The temperature
      // is physically incapable of dropping from 25C to 0C and back to
      // 25C in 1s; this is a BMC read glitch with no real fault. The old
      // rule lit ipmi_sel_critical for 30 days off this 1s transient.
      //
      // Fix: pair each Asserted event with the nearest later Deasserted
      // event on the same (sensor, event) string. If a Deasserted exists
      // within TRANSIENT_PAIR_WINDOW_MS after the assertion, treat as a
      // transient and exclude. Persistent or flapping faults (no
      // deassertion within the window, or deassertion outside it) still
      // fire. Pair-window is generous (60s) so genuine slow-recovery
      // faults aren't masked; the diagnostic signature is sub-second
      // bursts.
      const TRANSIENT_PAIR_WINDOW_MS = 60 * 1000;
      type SelEvent = NonNullable<typeof snap.ipmi.sel_events_recent>[number];
      const deassertedByKey = new Map<string, Array<{ ts: number; ev: SelEvent }>>();
      for (const e of snap.ipmi.sel_events_recent) {
        if (e.direction !== "Deasserted") continue;
        const t = parseSelTimestamp(e.timestamp);
        if (t === null) continue;
        const key = `${e.sensor} ${e.event}`;
        const list = deassertedByKey.get(key) ?? [];
        list.push({ ts: t, ev: e });
        deassertedByKey.set(key, list);
      }
      const isTransient = (assertTs: number | null, sensor: string, eventStr: string): boolean => {
        if (assertTs === null) return false; // unparseable timestamps fail-open (cannot prove transient)
        const list = deassertedByKey.get(`${sensor} ${eventStr}`);
        if (!list) return false;
        return list.some((d) => d.ts >= assertTs && d.ts - assertTs <= TRANSIENT_PAIR_WINDOW_MS);
      };

      // Annotate each event with age_days (number if parseable, null
      // otherwise) and apply window filter. The annotation lives in
      // evidence so the dashboard can display "2 hours ago" /
      // "1 year ago" / "(unknown age)" per event.
      const annotated = snap.ipmi.sel_events_recent
        .filter((e) => e.severity === "critical" && e.direction === "Asserted")
        .map((e) => {
          const t = parseSelTimestamp(e.timestamp);
          const age_days = t !== null ? Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)) : null;
          return {
            ...e,
            age_days,
            in_window: t === null || t >= cutoffMs,
            transient: isTransient(t, e.sensor, e.event),
          };
        });
      const critical = annotated.filter((e) => e.in_window && !e.transient);
      if (critical.length === 0) return [];

      const byType: Record<string, typeof critical> = {};
      for (const e of critical) { if (!byType[e.sensor_type]) byType[e.sensor_type] = []; byType[e.sensor_type].push(e); }
      const details = Object.entries(byType).map(([t, evts]) => `${t}: ${evts.map((e) => `${e.sensor}: ${e.event}`).join(", ")}`).join("; ");
      const recs: string[] = [];
      if (byType.memory) recs.push("Memory errors: identify slot with `ipmitool sel elist | grep -i memory`. Schedule DIMM replacement.");
      if (byType.power) recs.push("PSU event: check physical PSU and connections. Verify redundancy: `ipmitool chassis status`.");
      if (byType.watchdog) recs.push("Watchdog reset: OS or BMC became unresponsive. Check dmesg for root cause.");
      if (byType.processor) recs.push("CPU event: check for thermal throttling or MCE. Run `dmesg | grep -i mce`.");
      if (recs.length === 0) recs.push("Review full SEL: `ipmitool sel elist`.");

      // C11 activation (2026-05-19): surface bmc_vendor + parser_quality
      // from snap.ipmi (Crucible v0.12.0+). When the BMC vendor's
      // parser is a stub (lenovo/cisco/openbmc), the alert message
      // includes an honesty disclosure so operators can calibrate
      // trust in stub-vendor signal.
      const bmcVendor = snap.ipmi.bmc_vendor;
      const parserQuality = critical[0]?.parser_quality;
      const stubDisclosure =
        parserQuality === "stub"
          ? ` SEL parser for ${bmcVendor ?? "this BMC vendor"} is a stub in Crucible v0.12.0; treat severity as provisional and cross-check via \`ipmitool sel elist\` directly.`
          : "";
      return [{
        type: "ipmi_sel_critical",
        severity: "critical" as const,
        title: `IPMI: ${critical.length} critical hardware event(s) in last ${windowDays}d`,
        message: `BMC System Event Log: ${critical.length} critical event(s) in the last ${windowDays} days. ${details}${stubDisclosure}`,
        evidence: {
          critical_events: critical,
          sensor_types: Object.keys(byType),
          // Flat, comma-joined component list (e.g. "DIMM_A1, PSU2") for the
          // remediation quick-check to lead with, so the fix names the failed
          // part instead of re-deriving it via generic sensor-type triage.
          affected_components: [...new Set(critical.map((e) => e.sensor).filter(Boolean))].join(", "),
          window_days: windowDays,
          total_events_in_sel: annotated.length,
          events_outside_window: annotated.filter((e) => !e.in_window && !e.transient).length,
          transient_pairs_excluded: annotated.filter((e) => e.transient).length,
          ...(bmcVendor ? { bmc_vendor: bmcVendor } : {}),
          ...(parserQuality ? { parser_quality: parserQuality } : {}),
        },
        recommendation: recs.join(" "),
      }];
    },
  },

  // 16b. IPMI SEL full / near-full (P3 warning, 2026-07-14).
  //
  // WHY: a BMC whose System Event Log (SEL) is full stops recording new
  // events, so `ipmi_sel_critical` (and the SEL-derived half of
  // ecc_errors) goes structurally deaf to every future hardware fault.
  // The box stays "green" on every SEL-based rule while real DIMM / PSU /
  // fan / thermal faults accumulate unseen. Found on the val fleet box
  // "asrock" (2026-07-14): the ASRockRack BMC SEL was full, and the
  // "Event Logging Disabled ... Log full ... Asserted" record classifies
  // as `info` upstream, so ipmi_sel_critical (which keeps only
  // severity === "critical") dropped it and nothing surfaced the
  // blind-spot. This rule is that missing surface.
  //
  // Fires when EITHER:
  //   (a) a recent SEL event carries a log-full signature in its event
  //       text (/log( area)? full|logging disabled/i, matching both the
  //       "Log full" and vendor "Log area full" phrasings) with direction
  //       "Asserted" - the authoritative signal the BMC itself emits; OR
  //   (b) sel_entries_count is present and >= a high absolute heuristic.
  //       BMC SEL capacity is typically ~3000-4000 entries and we cannot
  //       read the exact capacity from the snapshot, so 3000 is a
  //       conservative near-full heuristic.
  //
  // Severity warning (not critical): the SEL being full is a monitoring
  // blind-spot, not itself a hardware fault. The operator exports then
  // clears it (irreversible), after which the next snapshot auto-resolves
  // this state-based alert.
  {
    type: "ipmi_sel_full",
    boot_grace_seconds: 30,
    evaluate(snap) {
      // Capability gate: no IPMI probe => nothing to say. Older agents and
      // VMs degrade silently.
      if (!snap.ipmi?.available) return [];

      // (a) Authoritative signal: the BMC's own "log full" / "event
      // logging disabled" assertion. The event text, not the sensor name,
      // distinguishes a full log from the benign "Log area reset/cleared"
      // record emitted after clearing a SEL.
      const events = snap.ipmi.sel_events_recent ?? [];
      const logFullEvent = events.find(
        (e) => /log( area)? full|logging disabled/i.test(e.event) && e.direction === "Asserted",
      );

      // (b) Near-full heuristic on the absolute entry count.
      const NEAR_FULL_ENTRIES = 3000;
      const count = snap.ipmi.sel_entries_count;
      const countNearFull = typeof count === "number" && count >= NEAR_FULL_ENTRIES;

      if (!logFullEvent && !countNearFull) return [];

      const trigger = logFullEvent ? "log_full_event" : "entry_count_heuristic";
      const countStr = typeof count === "number" ? `${count}` : "an unknown number of";
      const titleCount = typeof count === "number" ? `${count} entries` : "log-full event";
      return [{
        type: "ipmi_sel_full",
        severity: "warning" as const,
        title: `IPMI SEL full or near-full (${titleCount})`,
        message:
          `The BMC System Event Log holds ${countStr} entries and is full or near-full. ` +
          `A full SEL stops recording new events, so every SEL-based alert (ipmi_sel_critical, and the SEL-derived ` +
          `ecc_errors counts) goes deaf to future DIMM, PSU, fan, voltage, and thermal faults. ` +
          `Export the SEL for the record, then clear it so the BMC starts recording again.`,
        evidence: {
          trigger,
          sel_entries_count: count,
          near_full_threshold: NEAR_FULL_ENTRIES,
          log_full_event: logFullEvent ?? null,
        },
        recommendation:
          "Export the SEL first (`sudo ipmitool sel elist > /root/sel-$(date +%F).txt`), then clear it (`sudo ipmitool sel clear`). Confirm with `sudo ipmitool sel info` that the entry count dropped and the log is recording again.",
      }];
    },
  },

  // 16b. IPMI monitoring unavailable (P3, 2026-07-29; DataPacket fit study P1-2).
  //
  // Fires when the host HAS a BMC and the agent cannot get anything out of it.
  // While that is true, every IPMI-derived rule is structurally deaf at once:
  // ipmi_fan_failure, psu_redundancy_loss, ipmi_sel_critical, ipmi_sel_full and
  // the SEL-derived half of ecc_errors. The host reads green on all of them
  // regardless of its real hardware state, and remote power control and KVM are
  // gone too, so a machine that needs hands-on recovery cannot be recovered
  // remotely.
  //
  // HISTORY, because this rule has been pointed at three different things in a
  // day and the reasoning matters more than the current shape:
  //   - v1 (#596) fired on any `detection.reason` except `no_bmc_device`. Wrong in
  //     BOTH directions: `capability.ts` probes `ipmitool -V` BEFORE touching the
  //     BMC, so a BMC-less VM emitted `no_ipmitool_binary` and FIRED; while
  //     `no_bmc_device` is emitted whenever the wrapped sensor probe returns
  //     empty, which also covers a dead BMC, a missing wrapper and a timeout, and
  //     that value was SUPPRESSED. So it false-fired on VMs and could never report
  //     the one condition it was written for.
  //   - v2 (#600) narrowed to `ipmitool_cve_2020_5208` only, plus positive
  //     evidence of physical hardware, as a holding position.
  //   - v3 (this) drops the version reason entirely, because crucible 0.14.9 no
  //     longer blocks on it: the check could not tell a distro-backported 1.8.18
  //     from an unpatched one, so it disabled BMC monitoring on hosts that were
  //     never exposed. There is deliberately NO rule for the low-version advisory
  //     (`detection.ipmitool_below_cve_floor`): we cannot distinguish patched from
  //     unpatched, so any rule would be a guess.
  //
  // The signal it now uses only exists because the agent was taught to report
  // facts instead of a verdict (crucible #102): `bmc_device_node` is re-checked
  // EVERY snapshot, while `detection` is a one-shot startup result that cannot
  // notice a BMC dying later. A non-null device node is positive evidence the
  // kernel enumerated an IPMI controller, which no reason code could express.
  //
  // The device node also makes the old `dmi.is_virtual` guard unnecessary: a VM
  // has no `/dev/ipmi*`, so requiring the node is a strictly better filter than
  // inferring virtualization.
  //
  // Severity warning, not critical, matching ipmi_sel_full: losing the BMC is a
  // monitoring and management gap, not itself a hardware fault. State-based, so it
  // auto-resolves on the next snapshot once the probe works again.
  {
    type: "ipmi_monitoring_unavailable",
    boot_grace_seconds: 60,
    evaluate(snap) {
      const ipmi = snap.ipmi;
      if (!ipmi) return [];

      // Capability gate: agents older than 0.14.9 omit `probe` entirely. Without
      // it we cannot tell a failed collection from a skipped one, and guessing
      // would fire on every host whose BMC was simply never probed. Older agents
      // degrade silently.
      const probe = ipmi.probe;
      if (!probe) return [];

      // Positive evidence of a BMC. Null means UNDETERMINED (ipmi_devintf may not
      // be loaded), so it must NOT fire: that is the guard that keeps this off
      // VMs and BMC-less hardware, where absent IPMI is the correct steady state.
      const node = ipmi.bmc_device_node;
      if (!node) return [];

      // Two shapes count, and missing the second one made this rule blind to its
      // own purpose (adversarial review 2026-07-30, finding #1).
      //
      //  - "failed": we tried on THIS cycle and got nothing back.
      //  - "skipped" WITH detection.reason === "no_bmc_device": the agent did not
      //    try this cycle, because its cached startup probe had already come back
      //    empty. On a host with no BMC that is correct and this rule must stay
      //    silent, which is why the device-node check above runs first. But an
      //    empty probe on a host where the kernel DOES expose an IPMI device is a
      //    contradiction, and that contradiction is exactly a dead BMC.
      //
      // Without the second shape the rule only fired in the window between a BMC
      // dying and the next hourly capability refresh: after the refresh the cached
      // capability flips to unavailable, every later snapshot reports "skipped",
      // and the alert AUTO-RESOLVES while the BMC is still dead. A BMC that was
      // already dead at agent startup never fired at all.
      //
      // Deliberately NOT matched: "skipped" with any other reason.
      // `permission_denied` and `no_ipmitool_binary` are host-side tooling faults
      // rather than BMC faults, and `ipmitool_cve_2020_5208` only appears when an
      // operator opted into enforcement, where silence is their choice.
      const failedThisCycle = probe.status === "failed";
      const emptyAtDetection =
        probe.status === "skipped" && ipmi.detection?.reason === "no_bmc_device";
      if (!failedThisCycle && !emptyAtDetection) return [];

      return [{
        type: "ipmi_monitoring_unavailable",
        severity: "warning" as const,
        // States the OBSERVATION, not a cause. The agent's privileged helper
        // collapses a missing wrapper, a revoked sudo grant, a non-zero exit, a
        // timeout and a genuinely silent BMC into the same empty result, so
        // asserting "the BMC is not responding" is wrong whenever the real fault
        // is our own access path (adversarial review 2026-07-30, finding #3:
        // deleting the wrapper produced this alert while `ipmitool mc info` and
        // remote management were both fine).
        title: "BMC present but unreadable",
        message:
          `The kernel exposes an IPMI device on this host (${node}), so it has a BMC, but the agent read nothing from it. ` +
          `Two very different faults look identical from here: the BMC may be silent, or the agent's privileged access path ` +
          `may be broken (a missing or revoked sudo wrapper, or a timeout). Run \`sudo ipmitool mc info\` to tell them apart ` +
          `before escalating anything to hardware. ` +
          `Either way, every IPMI-derived alert is inactive while this lasts: fan failure, PSU redundancy loss, ` +
          `SEL critical events, SEL full, and the SEL-derived half of the ECC counters, so the host will read healthy ` +
          `on all of them regardless of its real state. If the BMC itself is down, remote power control and console ` +
          `access will be unavailable too and the machine cannot be recovered remotely.` +
          (probe.detail ? ` Agent detail: ${probe.detail}` : ""),
        evidence: {
          bmc_device_node: node,
          probe_status: probe.status,
          probe_detail: probe.detail ?? null,
          // The startup capability is included for contrast: it can still say
          // "available" here, which is exactly why it could not be used as the
          // signal. Seeing both side by side makes the distinction legible.
          startup_detection: ipmi.detection ?? null,
          ipmi_available: ipmi.available ?? null,
          rules_inactive_while_firing: [
            "ipmi_fan_failure",
            "psu_redundancy_loss",
            "ipmi_sel_critical",
            "ipmi_sel_full",
            "ecc_errors (SEL-derived half)",
          ],
        },
        recommendation:
          `Confirm by hand first: \`sudo ipmitool mc info\` should identify the BMC. If it answers, the problem is ` +
          `the agent's access path rather than the BMC: check that the privileged wrapper is intact ` +
          `(\`sudo glassmkr-crucible init\` repairs it) and that ${node} is still present. If \`mc info\` also fails, ` +
          `the BMC itself is not responding. Do NOT reset it blind: a cold reset (\`sudo ipmitool mc reset cold\`) ` +
          `is appropriate only after confirming with your hardware vendor, because some BMCs do not recover cleanly ` +
          `and hang past the operation, which on a remote machine is worse than the original fault. Escalate for ` +
          `out-of-band recovery instead if you are unsure, and note that remote reinstall and remote power control ` +
          `stay unavailable until the BMC is back.`,
      }];
    },
  },

  // 17a. CMOS battery low (P3, 2026-05-26).
  //
  // CR2032 motherboard coin-cell that maintains the RTC + BIOS NVRAM
  // across power-off. Nominal 3.0V (fresh 3.3V); below 2.6V the cell
  // is ~80% discharged and may fail to hold settings across a power
  // cycle. Symptoms when it dies: BIOS resets to defaults (boot order,
  // IPMI static IP, virtualization flags), clock drifts to the BIOS
  // build date on each cold boot, TLS validation breaks for anything
  // checking notBefore.
  //
  // PR #229 excluded VBAT sensors from psu_rail_drift (the CR2032's
  // tolerance band doesn't match an ATX rail's). This rule is the
  // missing other half: a low-VBAT reading SHOULD fire something. It
  // just shouldn't be psu_rail_drift.
  //
  // Sensor name matches the same allowlist trend-warnings uses for
  // exclusion: /vbat|cmos|^bat$|_bat$/i. _SCALED variants are skipped
  // because their value is voltage-divided and doesn't reflect the
  // cell's real voltage; without knowing the divider ratio we can't
  // compare to the 2.6V threshold safely.
  //
  // Severity: warning. Replacement is scheduled, not emergency. The
  // host continues running fine until the next power cycle.
  {
    type: "cmos_battery_low",
    boot_grace_seconds: 120,
    evaluate(snap) {
      if (!snap.ipmi?.available || !snap.ipmi.sensors?.length) return [];
      const THRESHOLD_V = 2.6;
      const NOMINAL_V = 3.0;
      const lowBatteries: Array<{ name: string; value: number; status: string }> = [];
      for (const s of snap.ipmi.sensors) {
        if (typeof s.value !== "number") continue;
        // Same allowlist trend-warnings/features.ts uses to exclude
        // these sensors from psu_rails. Keeps the two paths aligned;
        // when a sensor name is added to one filter it should be added
        // to the other.
        if (!/vbat|cmos|^bat$|_bat$/i.test(s.name)) continue;
        // _SCALED variants are voltage-divided readings (P_VBAT_SCALED
        // on Gigabyte MC12-LE0 reports ~1.55V for a 3.1V cell). Without
        // the divider ratio we can't compare to a 3V threshold; skip.
        if (/scaled/i.test(s.name)) continue;
        // Defensive: only fire on Volts-unit sensors. Some BMCs report
        // VBAT in alt units or as a discrete state.
        if (s.unit !== "Volts" && !s.unit.toLowerCase().includes("volt")) continue;
        if (s.value < THRESHOLD_V) {
          lowBatteries.push({ name: s.name, value: s.value, status: s.status });
        }
      }
      if (lowBatteries.length === 0) return [];
      const details = lowBatteries
        .map((b) => `${b.name} ${b.value.toFixed(2)}V`)
        .join(", ");
      return [{
        type: "cmos_battery_low",
        severity: "warning" as const,
        title: `CMOS battery low: ${details}`,
        message: `Motherboard CMOS coin-cell reads ${details}. CR2032 nominal is ${NOMINAL_V.toFixed(1)}V; below ${THRESHOLD_V.toFixed(1)}V indicates ~80% discharge. The host runs fine until the next power cycle, but BIOS settings (boot order, IPMI static IP, virtualization flags) will reset to defaults on cold boot if the cell fails. Replace at next scheduled maintenance.`,
        evidence: {
          low_batteries: lowBatteries,
          threshold_v: THRESHOLD_V,
          nominal_v: NOMINAL_V,
          fix_commands: [
            "# 1. Confirm the reading is stable across two snapshots",
            "sudo ipmitool sdr type Voltage | grep -iE 'vbat|cmos|bat'",
            "",
            "# 2. Note BIOS / UEFI settings before removing the cell;",
            "#    many boards reset to defaults including boot order,",
            "#    IPMI static IP, and virtualization flags.",
            "#    Capture from BIOS or via in-band tools:",
            "sudo dmidecode -t bios",
            "ipmitool lan print 1",
            "",
            "# 3. Schedule a power-off window; CR2032 cannot be hot-swapped.",
            "#    Power off cleanly: sudo systemctl poweroff",
            "#    Remove AC; wait 30 seconds for caps to drain.",
            "",
            "# 4. Replace the CR2032. Consult board manual for cell",
            "#    location; typically near the chipset, under a clip.",
            "",
            "# 5. Power on, re-enter BIOS, re-apply settings if reset.",
            "",
            "# 6. After boot, confirm the reading is back in spec:",
            "sudo ipmitool sdr type Voltage | grep -iE 'vbat|cmos|bat'",
          ],
        },
        recommendation: "Replace the CR2032 motherboard coin cell at the next scheduled maintenance window. Capture BIOS settings first; some boards reset to defaults when the cell is removed.",
      }];
    },
  },

  // 17. Fan failure
  {
    type: "ipmi_fan_failure",
    boot_grace_seconds: 60,
    evaluate(snap) {
      if (!snap.ipmi?.available || !snap.ipmi.fans?.length) return [];
      // An explicitly-ok fan is healthy even at rpm 0: discrete PSU fan
      // sensors (e.g. ASUS "PSU1 Slow FAN1 ... ok ... Transition to OK")
      // report a state string instead of an RPM, so the collector's rpm
      // defaults to 0 and the old `rpm === 0` clause fired a PERMANENT
      // phantom "2 of 9 fans" (a validation host, Round C). Trust the BMC's own ok
      // verdict; a genuinely stopped numeric fan trips its BMC threshold to
      // cr/nc, and a zero-RPM fan with no status code is parsed as critical
      // by the collector already.
      const failed = snap.ipmi.fans.filter((f) => f.status === "critical" || (f.rpm === 0 && f.status !== "absent" && f.status !== "ok"));
      if (failed.length === 0) return [];
      const total = snap.ipmi.fans.filter((f) => f.status !== "absent").length;
      const names = failed.map((f) => `${f.name} (${f.rpm} RPM)`).join(", ");
      return [{
        type: "ipmi_fan_failure",
        severity: "critical" as const,
        title: `Fan failure: ${failed.length} of ${total} fans`,
        message: `${failed.length} fan(s) stopped or critically slow: ${names}. Reduced cooling capacity.`,
        evidence: { failed_fans: failed, total_fans: total },
        recommendation: `Check physical fans. Monitor temps: \`ipmitool sdr type Temperature\`. Replace failed fan module. ${OWNERSHIP_REMEDIATION_NOTE}`,
      }];
    },
  },

  // === Additional Storage (2) ===

  // Filesystem read-only
  //
  // Two emission paths:
  //   - Legacy: detects "ro" in snap.disks[].options (mount-options
  //     reflect the kernel's remount).
  //   - C18 activation (2026-05-19): structured dmesg event
  //     "EXT4-fs (...): Remounting filesystem read-only" - this is
  //     the kernel reporting an in-progress remount-readonly event.
  //
  // Both paths can fire on the same snapshot; the dmesg path provides
  // a stronger "this just happened, here is the trigger" signal,
  // while the mount-options path may persist across reboots if the
  // filesystem was remounted ro on a prior boot.
  {
    type: "filesystem_readonly",
    evaluate(snap) {
      const results: AlertResult[] = [];

      // Legacy mount-options path.
      if (snap.disks) {
        const ignoredMounts = ["/proc", "/sys", "/dev", "/run", "/snap", "/boot/efi"];
        const ignoredFsTypes = ["proc", "sysfs", "devtmpfs", "tmpfs", "squashfs", "devpts", "securityfs", "cgroup", "cgroup2", "overlay"];
        for (const disk of snap.disks) {
          if (disk.fstype && ignoredFsTypes.includes(disk.fstype)) continue;
          if (ignoredMounts.some(p => disk.mount.startsWith(p))) continue;
          if (!disk.options) continue;
          // Crucible 0.14.11+ sets this when it could only read its OWN mount
          // namespace. The agent's unit uses ProtectSystem=strict, which remounts
          // `/` read-only inside that namespace, so those options describe the
          // sandbox and not the host. Asserting on them raised a CRITICAL on 19 of
          // 21 fleet hosts in July 2026. Abstain instead: unknown is a correct
          // answer here, a confident wrong one is what broke trust in this rule.
          if (disk.options_unreliable) continue;
          // An agent older than 0.14.11 read mount options from its OWN mount
          // namespace, where `ProtectSystem=strict` shows `/` as read-only, and it
          // does not send `options_unreliable` to tell us so. For those agents the
          // absence of the flag carries no information, so this path would keep
          // producing a false alert on healthy un-upgraded hosts, which is what it did
          // on 19 of 21 of our own. Abstain instead. The kernel-event path below is
          // unaffected and still catches a genuinely failed filesystem on any agent
          // version. Adversarial review 2026-07-30, finding #6.
          if (!agentAtLeast(snap.collector_version, "0.14.11")) continue;
          const opts = disk.options.split(",");
          const isRo = opts.some(o => o.trim() === "ro");
          if (!isRo) continue;
          // A mount flag alone is an OBSERVATION, not a diagnosis, so it no longer
          // claims corruption at CRITICAL on its own. Until 2026-07-30 this path
          // asserted "Likely I/O errors or corruption" at the product's highest
          // severity on the strength of one string, which is how a systemd
          // mount-namespace artifact presented as disk corruption on 19 of 21
          // hosts. A read-only mount also has entirely benign causes: an
          // intentionally read-only bind mount, immutable infrastructure, or a
          // filesystem an operator remounted by hand.
          //
          // The kernel is the authority on "this filesystem went read-only because
          // it broke", and it says so in dmesg. That evidence keeps its own
          // CRITICAL via the C18 path below, and it is not affected by any
          // namespace. So corroboration decides severity here rather than gating
          // the alert entirely: we still always report, because a genuinely
          // read-only root matters even when the dmesg ring buffer has aged out
          // past the event.
          // Match the kernel event to THIS device. A host-wide `.some()` escalated
          // every read-only mount on the host to critical as soon as any unrelated
          // device logged a remount, and then asserted that THIS device had failed:
          // an intentionally read-only /archive on sda1 was reported as critical and
          // blamed on sda1 because sdb1 broke. That is a false causal claim, the very
          // class of defect this rule was just rewritten to stop making. Adversarial
          // review 2026-07-30, finding #4.
          //
          // The kernel names the ext4 device without the /dev/ prefix ("sdb1",
          // "md127"), so compare on the bare name. When it names a device we cannot
          // match to any mount, we do NOT escalate: the dmesg path below still emits
          // its own independent critical for that device, so nothing is lost.
          const bare = (d: string) => d.replace(/^\/dev\//, "").trim();
          const kernelRoDevices = new Set(
            (snap.dmesg_events?.available ? snap.dmesg_events.events : [])
              .filter(ev => ev.event_type === "ext4_remount_readonly")
              .map(ev => bare(String(ev.details.device ?? "")))
              .filter(Boolean),
          );
          const kernelSaidSo = kernelRoDevices.has(bare(disk.device));
          results.push({
            type: "filesystem_readonly",
            severity: kernelSaidSo ? "critical" : "warning",
            title: `${disk.mount} is read-only`,
            message: kernelSaidSo
              ? `Filesystem at ${disk.mount} (${disk.device}) is mounted read-only, and the kernel logged a remount-read-only event on this host. That combination means the filesystem was taken read-only because it failed, not by choice.`
              : `Filesystem at ${disk.mount} (${disk.device}) is mounted read-only. The kernel has not logged a remount-read-only event, so this is reported as an observation: it may be intentional, or the triggering event may have aged out of the kernel log. Confirm whether it is expected before treating it as a fault.`,
            evidence: {
              scope: "mount_options",
              mount: disk.mount,
              device: disk.device,
              fstype: disk.fstype,
              options: disk.options,
              kernel_remount_event: kernelSaidSo,
            },
            recommendation: kernelSaidSo
              ? "Treat as a failing filesystem or device. Check `dmesg | grep -i 'i/o error\\|remount' | tail -20` and the SMART health of the underlying device, then plan an fsck during a maintenance window."
              : "Confirm whether read-only is intended for this mount. If it is not, check `dmesg | grep -i 'i/o error\\|remount' | tail -20` and the SMART health of the underlying device. A read-only bind mount or an operator remount will show nothing there.",
          });
        }
      }

      // C18 dmesg event corroboration.
      if (snap.dmesg_events?.available) {
        for (const ev of snap.dmesg_events.events) {
          if (ev.event_type !== "ext4_remount_readonly") continue;
          const device = String(ev.details.device ?? "unknown");
          results.push({
            type: "filesystem_readonly",
            severity: "critical",
            title: `EXT4 ${device} remounted read-only`,
            message: `Kernel reported EXT4 filesystem on ${device} being remounted read-only. This happens when ext4 detects metadata inconsistency it cannot recover from at runtime. Data at risk.`,
            evidence: {
              scope: "dmesg_remount_readonly",
              device,
              dmesg_timestamp: ev.timestamp_iso,
              kernel_initiated: true,
              raw_line: ev.raw_line,
            },
            recommendation: `EXT4 has flagged a filesystem inconsistency it could not recover from. Capture the kernel logs (\`dmesg -T | grep -B5 -A5 'EXT4.*read-only'\`), then run \`sudo fsck -y /dev/${device}\` from rescue mode or with the filesystem unmounted. Underlying disk hardware is the next suspect: pair with \`smartctl -a\` for the parent device. Plan replacement if corruption is recurring.`,
          });
        }
      }

      return results;
    },
  },

  // Inode exhaustion
  {
    type: "inode_high",
    evaluate(snap) {
      if (!snap.disks) return [];
      const ignoredMounts = ["/proc", "/sys", "/dev", "/run", "/snap", "/boot/efi"];
      const results: AlertResult[] = [];
      for (const disk of snap.disks) {
        if (ignoredMounts.some(p => disk.mount.startsWith(p))) continue;
        if (!disk.inodes_total || disk.inodes_total === 0) continue;
        const pct = ((disk.inodes_used ?? 0) / disk.inodes_total) * 100;
        if (pct < 85) continue;
        results.push({
          type: "inode_high",
          severity: pct >= 95 ? "critical" : "warning",
          title: `${disk.mount} inodes at ${pct.toFixed(1)}%`,
          message: `Inode usage on ${disk.mount}: ${disk.inodes_used?.toLocaleString()} / ${disk.inodes_total.toLocaleString()} (${pct.toFixed(1)}%). No new files can be created at 100%.`,
          evidence: { mount: disk.mount, inodes_used: disk.inodes_used, inodes_total: disk.inodes_total, percent: Math.round(pct * 10) / 10 },
          recommendation: "Find directories with many small files: `find / -xdev -printf '%h\\n' | sort | uniq -c | sort -rn | head -20`. Common culprits: /tmp, /var/spool, container layers.",
        });
      }
      return results;
    },
  },

  // === OS: Clock drift ===
  {
    type: "clock_drift",
    boot_grace_seconds: 300,
    evaluate(snap) {
      if (!snap.os_alerts || snap.os_alerts.time_drift_ms == null) return [];
      const driftSec = Math.abs(snap.os_alerts.time_drift_ms) / 1000;
      if (driftSec < 5) return [];
      return [{
        type: "clock_drift",
        severity: driftSec >= 60 ? "critical" : "warning",
        title: `Clock drift: ${driftSec.toFixed(1)}s`,
        message: `System clock is ${driftSec.toFixed(1)} seconds off from expected. ${driftSec >= 60 ? "Critical: may cause certificate validation failures and log corruption." : "Warning: exceeds 5s threshold."}`,
        evidence: { drift_ms: snap.os_alerts.time_drift_ms, drift_seconds: Math.round(driftSec * 10) / 10 },
        recommendation: "Check NTP sync: `timedatectl status`. Restart time sync: `sudo systemctl restart systemd-timesyncd`.",
      }];
    },
  },

  // === Security (7) ===

  // 18. SSH root password login
  {
    type: "ssh_root_password",
    evaluate(snap) {
      if (!snap.security?.ssh?.rootPasswordExposed) return [];
      return [{
        type: "ssh_root_password",
        severity: "warning",
        title: "SSH root login with password enabled",
        message: `PermitRootLogin is "${snap.security.ssh.permitRootLogin}" and PasswordAuthentication is "${snap.security.ssh.passwordAuthentication}". Root can be brute-forced over SSH.`,
        evidence: { permitRootLogin: snap.security.ssh.permitRootLogin, passwordAuthentication: snap.security.ssh.passwordAuthentication },
        recommendation: 'Set "PermitRootLogin prohibit-password", then reload sshd. On modern distros a drop-in in /etc/ssh/sshd_config.d/ overrides the main file (first match wins), so set it there or make sure no drop-in re-enables root password login. Verify with `sudo sshd -T | grep permitrootlogin`. Key-based root login still works.',
      }];
    },
  },

  // 18b. SSH config edited but not reloaded. The ssh fields above come from
  // `sshd -T` (the on-disk config), NOT the running daemon, so a fix that is
  // not reloaded would silently clear ssh_root_password while the host stays
  // exposed. This fires until the daemon reloads/restarts, so a host is never
  // reported all-clear on a staged-but-unapplied SSH change. configApplied is
  // undefined on pre-0.13.16 agents and defaults to applied when the collector
  // cannot determine it, so this never false-fires.
  {
    type: "ssh_config_unapplied",
    evaluate(snap) {
      if (!snap.security?.ssh || snap.security.ssh.configApplied !== false) return [];
      return [{
        type: "ssh_config_unapplied",
        severity: "warning",
        title: "SSH config changed but not applied",
        message: "sshd_config was modified after the sshd daemon last loaded its configuration. The running daemon is still using the previous config, so any change (including security hardening) is not yet in effect until you reload or restart sshd.",
        evidence: {
          permitRootLogin: snap.security.ssh.permitRootLogin,
          passwordAuthentication: snap.security.ssh.passwordAuthentication,
          configMtime: snap.security.ssh.configMtime ?? null,
          configLoadedAt: snap.security.ssh.configLoadedAt ?? null,
        },
        recommendation: isRhelFamily(snap)
          ? 'Validate then apply: "sudo sshd -t && sudo systemctl reload sshd" (this host is RHEL-family; the unit is sshd). Existing sessions are unaffected.'
          : 'Validate then apply: "sudo sshd -t && sudo systemctl reload ssh" (Debian/Ubuntu) or "... reload sshd" (RHEL). Existing sessions are unaffected.',
      }];
    },
  },

  // 19. No firewall
  {
    type: "no_firewall",
    evaluate(snap) {
      if (!snap.security || snap.security.firewall.active) return [];
      return [{
        type: "no_firewall",
        severity: "warning",
        title: "No firewall active",
        message: "No active firewall rules detected (checked UFW, firewalld, nftables, iptables). All ports are exposed unless protected by network-level ACLs.",
        evidence: { source: snap.security.firewall.source },
        // Allow SSH BEFORE enabling (lockout safety), and use non-interactive
        // forms: bare `ufw enable` prompts "Proceed (y|n)?" and hangs any
        // non-interactive run (a script or an agent), so lead with the
        // --force variant. (Validation-ladder finding 2026-07-05: an 8B agent
        // read this line, ran `ufw enable`, and looped on the prompt.)
        recommendation: isRhelFamily(snap)
          ? 'Enable a firewall (RHEL-family). Non-interactive, SSH kept open: "sudo firewall-cmd --permanent --add-service=ssh && sudo systemctl enable --now firewalld && sudo firewall-cmd --reload". Debian/Ubuntu equivalent: "sudo ufw allow OpenSSH && sudo ufw --force enable".'
          : 'Enable a firewall (Debian/Ubuntu). Non-interactive, SSH kept open: "sudo ufw allow OpenSSH && sudo ufw --force enable" (bare "ufw enable" prompts for y/n and hangs non-interactive runs). RHEL/Rocky equivalent: "sudo firewall-cmd --permanent --add-service=ssh && sudo systemctl enable --now firewalld && sudo firewall-cmd --reload".',
      }];
    },
  },

  // 20. Pending security updates
  {
    type: "pending_security_updates",
    evaluate(snap) {
      if (!snap.security?.pending_updates?.available) return [];
      const count = snap.security.pending_updates.pendingCount;
      if (count <= 0) return [];
      // Suppress when auto-updates are on: unattended-upgrades / dnf-automatic
      // will apply these patches on their own schedule (usually within 24h),
      // so paging the user for a condition the OS already resolves is noise.
      // The `unattended_upgrades_disabled` rule is the counterpart that fires
      // when the user actually needs to patch manually.
      if (snap.security.auto_updates?.configured) return [];
      const d = snap.security.pending_updates;
      const applyCmd = d.distro === "ubuntu" || d.distro === "debian" ? '"sudo apt update && sudo apt upgrade -y"' : '"sudo dnf update --security"';
      return [{
        type: "pending_security_updates",
        severity: "warning",
        title: `${count} security update${count > 1 ? "s" : ""} pending`,
        message: `${count} security update${count > 1 ? "s" : ""} pending on this ${d.distro} server.${count >= 10 ? " System is significantly behind on patches." : ""}`,
        evidence: { pendingCount: count, distro: d.distro },
        recommendation: `Apply security updates: ${applyCmd}.`,
      }];
    },
  },

  // 21. Kernel vulnerabilities
  //
  // Severity nuance (2026-05-18, dogfood-loop iteration 4): some
  // "Vulnerable" sysfs entries carry an additional status suffix that
  // indicates the kernel is engaged in active software mitigation
  // even without the microcode fix. Concretely on AMD TSA / MDS /
  // MMIO families the sysfs reports
  //   "Vulnerable: Clear CPU buffers attempted, no microcode"
  // which means the kernel runs the buffer-clear instruction sequence
  // on every context switch; the residual gap is the microcode
  // optimisation, not the mitigation itself. When EVERY unmitigated
  // vuln on a host is in this state the alert is informational, not
  // warning-grade: the only remediation is waiting for upstream
  // microcode, which is not customer-actionable. Drop severity to
  // info in that case so customers don't have to ACK-with-rationale
  // every microcode-pending host on the fleet.
  //
  // Plain "Vulnerable" (no colon descriptor) stays at warning: that
  // means the kernel has nothing engaged either. Same for
  // "Vulnerable: Microcode update required" style strings where the
  // descriptor names the missing action rather than describing a
  // software fall-back. The known-good phrases are matched
  // explicitly; future kernels may add new phrases worth recognising,
  // which can be appended to KERNEL_SOFTWARE_MITIGATION_PHRASES.
  {
    type: "kernel_vulnerabilities",
    evaluate(snap) {
      const results: AlertResult[] = [];

      // Branch A (existing): /sys/devices/system/cpu/vulnerabilities
      // CPU-mitigation status. Spectre/Meltdown family. Severity nuance
      // documented above; "info" when all unmitigated vulns are running
      // active kernel software mitigation.
      if (snap.security?.kernel_vulns?.length) {
        const unmitigated = snap.security.kernel_vulns.filter((v) => !v.mitigated);
        if (unmitigated.length > 0) {
          // Phrases that appear in /sys/devices/system/cpu/vulnerabilities/*
          // when the kernel is actively running a software mitigation but
          // microcode-level fix is unavailable. When EVERY unmitigated vuln
          // matches one of these, severity downgrades to info (it's
          // working-as-designed, not actionable by the customer until
          // upstream microcode ships).
          //
          // Extended 2026-05-21 cycle 3 to include:
          // - "safe ret" : AMD SRSO software mitigation (spec_rstack_overflow);
          //   confirmed on val-L4 (AMD EPYC 8004-series)
          // - "retpoline" : legacy spectre_v2 software mitigation
          const KERNEL_SOFTWARE_MITIGATION_PHRASES = [
            "clear cpu buffers attempted",
            "safe ret",
            "retpoline",
          ];

          // Per-vuln classification. The /sys text uses a small set of
          // conventions; we map each unmitigated vuln to one of three
          // states so the alert message can show the operator WHY each
          // one is here and whether anything is actionable. See block
          // comment above the rule.
          //
          // Classification:
          //   - software_engaged: status contains one of the
          //     KERNEL_SOFTWARE_MITIGATION_PHRASES above. Kernel runs a
          //     band-aid; full fix is microcode-pending. Customer cannot
          //     act until the vendor ships microcode.
          //   - awaiting_microcode_no_software: bare "Vulnerable" with
          //     no software-mitigation phrase (e.g. Intel Downfall) OR
          //     explicit "no microcode" string. No software fix engaged
          //     and no microcode loaded; customer waits on vendor.
          //   - actionable: anything else that mentions actionable text
          //     ("update required", "reboot needed", etc) or anything
          //     we don't recognise. Be conservative: if it isn't clearly
          //     vendor-side, surface for operator review.
          //
          // operator_action evidence field follows: if every unmitigated
          // vuln is in the first two states (pure vendor-side), the UI
          // can render a one-click "ACK as vendor-side" button. If any
          // vuln is `actionable`, the operator should look first.
          const VENDOR_BY_VULN: Record<string, "AMD" | "Intel"> = {
            tsa: "AMD",
            spec_rstack_overflow: "AMD",
            gather_data_sampling: "Intel",
            mds: "Intel",
            reg_file_data_sampling: "Intel",
            tsx_async_abort: "Intel",
            srbds: "Intel",
            mmio_stale_data: "Intel",
            l1tf: "Intel",
          };

          type VulnState = "software_engaged" | "actionable";
          const perVuln = unmitigated.map((v) => {
            const status = v.status || "";
            const lower = status.toLowerCase().trim();
            const vendor = VENDOR_BY_VULN[v.name];
            const vendorSuffix = vendor ? `; awaiting ${vendor} microcode` : "; awaiting vendor microcode";

            // 1. Software band-aid engaged?
            const swEngaged = KERNEL_SOFTWARE_MITIGATION_PHRASES.some((p) => lower.includes(p));
            if (swEngaged) {
              return {
                name: v.name,
                status,
                state: "software_engaged" as VulnState,
                hint: `software band-aid engaged${vendorSuffix}`,
              };
            }

            // 2. No software band-aid. Everything else - bare "Vulnerable"
            // and "Vulnerable: No microcode" alike - is ACTIONABLE, not
            // vendor-side. sysfs "No microcode" means the microcode CURRENTLY
            // LOADED on this host lacks the mitigation; the fix is to update
            // the CPU microcode package (+ kernel) and reboot. It does NOT
            // mean the vendor shipped no fix - that is only knowable after
            // updating and still seeing "Vulnerable". Previously "no microcode"
            // was labelled awaiting_microcode_no_software -> ack_vendor_side,
            // which told operators to ACK a fixable vuln (blind-remediation
            // campaign: Intel GDS microcode existed, it just was not installed
            // because non-free-firmware was disabled). The vendor is not the
            // blocker here, so the hint omits vendorSuffix.
            return {
              name: v.name,
              status,
              state: "actionable" as VulnState,
              hint: "update CPU microcode + kernel and reboot; vendor-side only if still Vulnerable afterwards",
            };
          });

          // With a software band-aid engaged on every unmitigated vuln, the
          // kernel has done its part and the residual really is microcode-
          // dependent, so this is the one case we still label vendor-side
          // (ACK-able) - but the message still tells the operator to try a
          // microcode update first. Any `actionable` vuln flips the whole
          // alert to review + warning: there is a fix to attempt.
          const allSoftMitigated = perVuln.every((p) => p.state === "software_engaged");
          const operator_action = allSoftMitigated ? "ack_vendor_side" : "review";
          const severity: AlertResult["severity"] = allSoftMitigated ? "info" : "warning";

          // Multi-line message: one bullet per vuln, with state hint.
          // Kept under ~80 chars per line so it renders cleanly in the
          // alert card without horizontal scroll.
          const bullets = perVuln
            .map((p) => `• ${p.name}: ${p.status}  [${p.hint}]`)
            .join("\n");
          const trailer = allSoftMitigated
            ? "\nA kernel software mitigation is engaged for every unmitigated vuln. Try a CPU microcode update to fully close them; only if no microcode update is available for your CPU is this genuinely vendor-side (then ACK). Auto-resolves when /sys reports a mitigation."
            : "\nUpdate the CPU microcode + kernel packages and reboot. On Debian/Ubuntu the microcode package is in the non-free-firmware component; enable it first if apt reports no installation candidate. A vuln is vendor-side only if it is still Vulnerable after updating.";
          const message = `Unmitigated CPU vulnerabilities:\n${bullets}${trailer}`;

          const titleSuffix = allSoftMitigated ? " (kernel software mitigation engaged)" : "";
          results.push({
            type: "kernel_vulnerabilities",
            severity,
            title: `${unmitigated.length} CPU vulnerability mitigations missing${titleSuffix}`,
            message,
            evidence: {
              scope: "cpu_mitigations",
              unmitigated,
              per_vuln: perVuln,
              total: snap.security.kernel_vulns.length,
              all_software_mitigated: allSoftMitigated,
              operator_action,
            },
            recommendation: 'Update CPU microcode + kernel and reboot (Debian/Ubuntu: microcode is in the non-free-firmware component; enable it if apt finds no candidate). Check: "grep . /sys/devices/system/cpu/vulnerabilities/*".',
          });
        }
      }

      // Branch B (C13 activation, 2026-05-19): upstream CVE patch
      // status from distro sources. snap.cve consolidates Ubuntu Pro /
      // dnf / zypper output into a kernel-CVE feed with severity
      // classification. Capability-gated; pre-0.12.0 agents miss this
      // branch entirely.
      //
      // Severity per the rule's standing convention: critical pending
      // CVEs => warning (alert tier); important => info (informational
      // tier). Critical /Important on the Linux-distribution scale
      // would page if escalated, but per pattern-library Cat 6 the
      // dashboard rule defaults are conservative for the security
      // category and customer-configurable.
      const cve = snap.cve;
      if (cve?.available) {
        const crit = cve.total_critical_pending;
        const imp = cve.total_important_pending;
        if (crit > 0 || imp > 0) {
          const topCriticalCves = cve.kernel_cves_pending
            .filter((c) => c.severity === "critical")
            .slice(0, 5)
            .map((c) => c.cve_id);
          const severity: AlertResult["severity"] = crit > 0 ? "warning" : "info";
          const stubNote =
            cve.parser_quality === "stub"
              ? ` Severity classification on ${cve.distro} relies on text-scrape parsing (parser_quality: stub); cross-check via the upstream advisory before remediation.`
              : "";
          results.push({
            type: "kernel_vulnerabilities",
            severity,
            title: `${crit + imp} kernel CVE patch${crit + imp > 1 ? "es" : ""} pending (${crit} critical, ${imp} important)`,
            message: `Distro CVE feed (${cve.distro}) reports ${crit} critical and ${imp} important kernel CVE patches pending. ${topCriticalCves.length > 0 ? `Top critical: ${topCriticalCves.join(", ")}.` : ""}${stubNote}`,
            evidence: {
              scope: "distro_cve",
              distro: cve.distro,
              total_critical_pending: crit,
              total_important_pending: imp,
              top_critical_cves: topCriticalCves,
              parser_quality: cve.parser_quality,
            },
            recommendation:
              cve.distro === "ubuntu"
                ? "Apply via apt: `sudo apt update && sudo apt upgrade linux-image-$(uname -r | cut -d- -f1-2 | cut -d. -f1-2)*`. Or for Ubuntu Pro: `sudo pro fix CVE-...` per CVE."
                : cve.distro === "rhel" || cve.distro === "rocky" || cve.distro === "alma" || cve.distro === "centos" || cve.distro === "fedora"
                  ? "Apply via dnf: `sudo dnf update --security kernel`. Reboot required for kernel changes to take effect."
                  : cve.distro === "sles" || cve.distro === "opensuse"
                    ? "Apply via zypper: `sudo zypper patch --category=security`."
                    : "Apply the distro's security update path; the running kernel needs patches the distro tracks as critical or important.",
          });
        }
      }

      return results;
    },
  },

  // 22. Kernel needs reboot
  {
    type: "kernel_needs_reboot",
    evaluate(snap) {
      if (!snap.security?.kernel_reboot?.needsReboot) return [];
      const k = snap.security.kernel_reboot;
      // The collector derives needsReboot from a STRING inequality
      // (installed !== running), so it also fires when the RUNNING kernel is
      // NEWER than apt's newest installed one. That happens on a host booted
      // into a mainline or custom kernel: those ship as linux-image-unsigned-*,
      // which the collector's linux-image-[0-9] scan cannot see, so `installed`
      // reports the older distro kernel. The alert then never clears, and a
      // reboot cannot clear it either because GRUB boots the same newer kernel
      // again (found on a real host running 6.10.0-061000-generic while apt's
      // newest was 6.8.0-136-generic; alerting since 2026-05-22).
      // Suppress only when running is provably at least installed; an
      // unparseable version falls through so a genuine pending reboot is never
      // hidden.
      if (runningKernelAtLeastInstalled(k.running, k.installed)) return [];
      return [{
        type: "kernel_needs_reboot",
        severity: "warning",
        title: "Reboot required for kernel update",
        message: `Running kernel: ${k.running}. Installed kernel: ${k.installed}. A reboot is needed to apply the newer kernel.`,
        evidence: { running: k.running, installed: k.installed },
        recommendation: "Schedule a reboot to apply the newer kernel. Security patches may not be active until then.",
      }];
    },
  },

  // 22.1 boot_config_broken (CRITICAL) + 22.2 boot_config_drift (WARNING).
  //
  // From the val-rocky boot-failure postmortem (2026-08-30): a kernel update
  // baked a stale root=UUID (from a prior reinstall) into the new boot entry,
  // so the box dropped to the dracut emergency shell on the next reboot with no
  // prior warning. Crucible 1.2.0's boot_config collector cross-checks every
  // boot target's root= reference against the filesystems that actually exist
  // and precomputes the flags these rules read. Capability-gated on
  // snap.boot_config?.available: older agents omit the field, unprivileged
  // hosts report available:false, and both cases stay silent. Never fires on a
  // healthy box (proven against the four val distros as negative controls).
  {
    type: "boot_config_broken",
    // The whole point is to warn in the window BEFORE the fatal reboot, so no
    // boot-grace suppression: a freshly-booted box that already has a broken
    // NEXT-boot target must page immediately.
    evaluate(snap) {
      const bc = snap.boot_config;
      if (!bc || bc.available !== true) return [];
      // The critical signal: the entry the bootloader will select next cannot
      // find its root filesystem. `default_entry_bootable === false` is set
      // only when that entry's root=UUID/LABEL resolves to NOTHING present.
      if (bc.default_entry_bootable !== false) return [];
      const def = bc.entries.find((e) => e.is_default) ?? null;
      const badSpec = def?.root_spec ?? "(unknown)";
      const mounted = bc.mounted_root;
      const kern = def?.kernel ? ` (kernel ${def.kernel})` : "";
      return [{
        type: "boot_config_broken",
        severity: "critical",
        title: "Next boot will fail: boot entry points at a missing root filesystem",
        message: `The boot entry the bootloader will select next${kern} sets ${badSpec}, but no such filesystem exists on this host. The currently mounted root is ${mounted?.source ?? "unknown"} (UUID ${mounted?.uuid ?? "unknown"}). This host is running now, but the NEXT reboot will drop to the emergency shell and not come back. Fix the boot configuration before rebooting. This is the classic stale-root-UUID failure: a kernel update inherited a boot entry whose root filesystem UUID no longer exists.`,
        evidence: {
          mounted_root: mounted,
          default_entry: def,
          cmdline_source: bc.cmdline_source,
          unbootable_entry_count: bc.unbootable_entry_count,
          source_regressed: bc.source_regressed,
          fix_commands: [
            "# 1. Confirm the REAL root filesystem UUID (ground truth):",
            "findmnt -no SOURCE,UUID /",
            "",
            "# 2. See what the boot entries and the cmdline source request:",
            "grep -r root=UUID /boot/loader/entries/ /etc/kernel/cmdline 2>/dev/null   # RHEL family",
            "grep -r root=UUID /boot/grub/grub.cfg 2>/dev/null                          # Debian family",
            "",
            "# 3a. RHEL family: fix the SOURCE so future kernels inherit the right",
            "#     UUID, then the entries. Replace OLD with the real UUID from step 1:",
            "#   sudo sed -i 's/OLD-UUID/REAL-UUID/g' /etc/kernel/cmdline /boot/loader/entries/*.conf",
            "# 3b. Debian family: fix /etc/fstab if wrong, then regenerate:",
            "#   sudo update-grub",
            "",
            "# 4. Verify NOTHING still points at the missing UUID before rebooting:",
            "grep -rl OLD-UUID /boot /etc/kernel 2>/dev/null   # must print nothing",
          ],
        },
        recommendation: `Do not reboot until this is fixed. The next-boot entry${kern} references ${badSpec}, which is not a filesystem present on this host, so the reboot will strand the box in the dracut emergency shell. Align every boot entry and the kernel-cmdline source to the real root UUID (${mounted?.uuid ?? "from findmnt -no UUID /"}), then confirm no reference to the missing UUID remains.`,
      }];
    },
  },
  {
    type: "boot_config_drift",
    evaluate(snap) {
      const bc = snap.boot_config;
      if (!bc || bc.available !== true) return [];
      // Do not double-report: if the default entry is already broken, the
      // critical rule owns it.
      if (bc.default_entry_bootable === false) return [];
      const sourceBad = bc.source_regressed === true;
      const wrongFs = bc.default_entry_wrong_fs === true;
      const staleEntries = bc.unbootable_entry_count > 0;
      if (!sourceBad && !wrongFs && !staleEntries) return [];
      const mounted = bc.mounted_root;
      const reasons: string[] = [];
      if (sourceBad) reasons.push(`the kernel-cmdline source (${bc.cmdline_source?.path ?? "/etc/kernel/cmdline"}) sets ${bc.cmdline_source?.root_spec ?? "a root="} that is not the mounted root, so the NEXT kernel install would inherit a wrong root and fail to boot`);
      if (wrongFs) reasons.push("the default boot entry resolves to a different existing filesystem than the one currently mounted as root");
      if (staleEntries) reasons.push(`${bc.unbootable_entry_count} boot entr${bc.unbootable_entry_count === 1 ? "y references a filesystem" : "ies reference filesystems"} that do not exist (a fallback boot into ${bc.unbootable_entry_count === 1 ? "it" : "one of them"} would fail)`);
      return [{
        type: "boot_config_drift",
        severity: "warning",
        title: "Boot configuration drift: a future or fallback boot could strand this host",
        message: `This host boots correctly today, but ${reasons.join("; and ")}. Left unaddressed, a kernel update or a fallback boot can drop the box to the emergency shell. The mounted root is ${mounted?.source ?? "unknown"} (UUID ${mounted?.uuid ?? "unknown"}).`,
        evidence: {
          mounted_root: mounted,
          cmdline_source: bc.cmdline_source,
          default_entry_wrong_fs: bc.default_entry_wrong_fs,
          unbootable_entry_count: bc.unbootable_entry_count,
          source_regressed: bc.source_regressed,
          unbootable_entries: bc.entries.filter((e) => e.resolvable === false),
          fix_commands: [
            "# Confirm the real root UUID:",
            "findmnt -no SOURCE,UUID /",
            "# RHEL family: align the cmdline source + entries to it:",
            "grep -r root=UUID /etc/kernel/cmdline /boot/loader/entries/ 2>/dev/null",
            "#   sudo sed -i 's/WRONG-UUID/REAL-UUID/g' /etc/kernel/cmdline /boot/loader/entries/*.conf",
            "# Debian family: fix /etc/fstab if needed, then:",
            "#   sudo update-grub",
          ],
        },
        recommendation: `Not yet urgent (the host boots today), but fix before the next kernel update: ${reasons.join("; ")}. Align the boot configuration to the real root UUID (${mounted?.uuid ?? "from findmnt -no UUID /"}). Acknowledge if you have verified this is expected for this host.`,
      }];
    },
  },

  // C1-C6 activation new rules (2026-05-19, CC_SPEC_FORGE_FOLLOWUP_C1_C6_ACTIVATION).
  // All four capability-gate on the corresponding Crucible v0.10.4+ snapshot
  // fields; older agents emit zero alerts from these paths.

  // 23.1 cpu_pressure_high (PSI classifier; parent for cpu_high + load_high)
  {
    type: "cpu_pressure_high",
    evaluate(snap) {
      if (!snap.psi?.cpu?.some) return [];
      const some = snap.psi.cpu.some;
      // Trigger per spec §2.1: avg60 > 20% OR avg300 > 10%. Sustained-
      // intervals refinement (5 / 15 min) deferred until cross-snapshot
      // state lands in the evaluator; today fires on per-snapshot
      // threshold-breach. Documented in the rule's source_note.
      if (some.avg60 <= 20 && some.avg300 <= 10) return [];
      const severity = some.avg60 > 50 ? "critical" : "warning";
      return [{
        type: "cpu_pressure_high",
        severity,
        title: `CPU pressure ${some.avg60.toFixed(1)}% (avg60)`,
        message: `PSI reports avg60=${some.avg60.toFixed(1)}% / avg300=${some.avg300.toFixed(1)}% CPU stalls on this host. Some process is consuming CPU heavily and blocking others.`,
        evidence: {
          avg10: some.avg10,
          avg60: some.avg60,
          avg300: some.avg300,
          total_us: some.total,
        },
        recommendation: "Identify top CPU consumers with `ps -eo pid,pcpu,comm --sort=-pcpu | head -20`. Check systemd-cgls for which cgroup is dominating.",
      }];
    },
  },

  // 23.2 mem_pressure_high (PSI + pswpin corroboration)
  {
    type: "mem_pressure_high",
    evaluate(snap) {
      if (!snap.psi?.memory?.full) return [];
      const full = snap.psi.memory.full;
      if (full.avg10 <= 10) return [];
      // Corroborator: active paging (pswpin_rate > 0) OR cgroup OOM
      // (we proxy via snap.os_alerts.oom_kills_recent > 0). MemAvailable-
      // falling check deferred (requires cross-snapshot state).
      const pswpinActive = (snap.vmstat?.pswpin_rate ?? 0) > 0;
      const oomActive = (snap.os_alerts?.oom_kills_recent ?? 0) > 0;
      if (!pswpinActive && !oomActive) return [];
      return [{
        type: "mem_pressure_high",
        severity: "warning",
        title: `Memory pressure ${full.avg10.toFixed(1)}% (avg10, corroborated)`,
        message: `PSI memory.full.avg10=${full.avg10.toFixed(1)}% with ${pswpinActive ? "active swap-in" : ""}${pswpinActive && oomActive ? " + " : ""}${oomActive ? "recent OOM kills" : ""}. Genuine memory pressure.`,
        evidence: {
          full_avg10: full.avg10,
          full_avg60: full.avg60,
          pswpin_active: pswpinActive,
          pswpin_rate: snap.vmstat?.pswpin_rate ?? null,
          oom_recent: oomActive,
        },
        recommendation: "Identify the memory hog (ps -rss). Check if any service is cgroup-limited beyond its working set.",
      }];
    },
  },

  // 23.2b io_pressure_high (campaign finding 2026-05-20)
  //
  // Companion to cpu_iowait_high. On modern enterprise NVMe storage,
  // even sustained sync write workloads rarely produce measurable
  // iowait percent - the underlying device completes writes fast
  // enough that the CPU isn't blocked long enough to register. PSI
  // io.full captures the same "the CPU stalled waiting for IO"
  // signal at finer granularity (microseconds of stall), so it fires
  // on NVMe-only hosts that cpu_iowait_high never catches.
  //
  // Mirrors mem_pressure_high's design: PSI threshold + independent
  // corroborator to avoid false positives from short PSI bursts.
  //
  // Corroborators (any one):
  //   - High disk latency (>= 50ms p99 read or write on any device)
  //   - Recent disk I/O errors (snap.io_errors.count > 0)
  //   - iowait >= 5% (lower than cpu_iowait_high's 20%; this is the
  //     "some" corroboration band)
  //
  // Subordinate to cpu_iowait_high when both fire on the same host
  // (set via YAML; the runtime subordination collapses the pair as
  // one incident).
  {
    type: "io_pressure_high",
    evaluate(snap, config) {
      if (!snap.psi?.io?.full) return [];
      const full = snap.psi.io.full;
      if (full.avg10 <= 10) return [];
      // Gate on SUSTAINED pressure (avg60), not a 10-second avg10 spike: a
      // brief Docker-on-loopback write burst spikes avg10 while avg60 stays
      // low, which is not a sustained I/O problem (round 5 false alarm:
      // full_avg10=20% with full_avg60=6% on an idle, healthy box).
      const SUSTAINED_AVG60 = config.io_pressure_avg60_percent ?? 10;
      if ((full.avg60 ?? 0) < SUSTAINED_AVG60) return [];

      // Corroborator checks.
      const slowDevices = (snap.io_latency ?? []).filter((d) =>
        (d.avg_read_latency_ms ?? 0) >= 50 || (d.avg_write_latency_ms ?? 0) >= 50,
      );
      const hasSlowDevice = slowDevices.length > 0;
      const hasIoErrors = (snap.io_errors?.count ?? 0) > 0;
      const moderateIowait = (snap.cpu?.iowait_percent ?? 0) >= 5;

      if (!hasSlowDevice && !hasIoErrors && !moderateIowait) return [];

      const corroborators: string[] = [];
      if (hasSlowDevice) {
        const names = slowDevices.map((d) => d.device).slice(0, 3).join(", ");
        corroborators.push(`high disk latency (${names})`);
      }
      if (hasIoErrors) {
        corroborators.push(`${snap.io_errors!.count} recent I/O error${snap.io_errors!.count === 1 ? "" : "s"}`);
      }
      if (moderateIowait) {
        corroborators.push(`iowait ${snap.cpu!.iowait_percent.toFixed(1)}%`);
      }

      return [{
        type: "io_pressure_high",
        severity: "warning",
        title: `I/O pressure ${full.avg10.toFixed(1)}% (avg10, corroborated)`,
        message: `PSI io.full.avg10=${full.avg10.toFixed(1)}%; corroborated by ${corroborators.join(" + ")}. The CPU is stalling on I/O ${full.avg10.toFixed(1)}% of recent time. On modern NVMe this signal fires when iowait stays at zero but PSI catches the brief blocking; on slower storage iowait should also be elevated.`,
        evidence: {
          full_avg10: full.avg10,
          full_avg60: full.avg60,
          slow_devices: slowDevices.map((d) => ({
            device: d.device,
            avg_read_latency_ms: d.avg_read_latency_ms,
            avg_write_latency_ms: d.avg_write_latency_ms,
          })),
          io_errors_count: snap.io_errors?.count ?? 0,
          iowait_percent: snap.cpu?.iowait_percent ?? 0,
        },
        recommendation: "Identify the heavy I/O process(es) with `sudo iotop -obn1` (top by I/O) and check per-device latency with `iostat -xz 1 5`. If `iowait` is low but PSI is high, the underlying device is fast enough but the workload is bursty enough to block CPU briefly; look at queue depth, fsync patterns, and whether the application can batch writes.",
      }];
    },
  },

  // 23.3 mce_uncorrected (EDAC)
  {
    type: "mce_uncorrected",
    evaluate(snap) {
      if (!snap.ecc_edac) return [];
      const total = snap.ecc_edac.edac_uncorrected_total;
      if (total <= 0) return [];
      // Identify the affected DIMM(s).
      const affected = (snap.ecc_edac.dimms ?? []).filter((d) => d.ue_count > 0);
      const dimmLabel = affected.length > 0
        ? affected.map((d) => `${d.label || d.location || "?"} (${d.ue_count})`).join(", ")
        : "DIMM location unknown";
      return [{
        type: "mce_uncorrected",
        severity: "critical",
        title: `Uncorrected memory error: ${dimmLabel}`,
        message: `EDAC reports ${total} uncorrected memory error(s). The CPU could not correct the error; in-flight data may have been corrupted. Replace the affected DIMM.`,
        evidence: {
          edac_uncorrected_total: total,
          edac_corrected_total: snap.ecc_edac.edac_corrected_total,
          affected_dimms: affected,
        },
        recommendation: "Schedule a maintenance window to replace the affected DIMM. See FIX block for ras-mc-ctl identification commands. " + OWNERSHIP_REMEDIATION_NOTE,
      }];
    },
  },

  // 23.3b memory_channels_underpopulated (DIMM topology Tier 1,
  // CC_SPEC_DIMM_POPULATION_2026-07-04). Advisory, not a fault: empty
  // memory channels or a rank/2DPC downclock silently cost bandwidth
  // (an 8-channel EPYC with 4 DIMMs runs ~half its peak). Fires only on
  // firmware-reported topology facts (SMBIOS Type 17), so there is no
  // threshold to tune. Absent memory_topology (VM, old agent, no
  // dmidecode) or a degenerate read means no evaluation. The Tier-2
  // controller/quadrant-balance judgment is deliberately NOT here yet;
  // it ships after fleet validation (spec).
  {
    type: "memory_channels_underpopulated",
    evaluate(snap) {
      const t = snap.memory_topology;
      if (!t || t.populated_slots === 0 || t.available_channels === 0) return [];
      const missing = t.available_channels - t.populated_channels;
      const downclocked = t.downclocked === true;
      // Actionability gate for the downclock signal: only alert when an operator
      // could actually raise the speed. That holds for a 2-DIMMs-per-channel
      // population (rebalancing toward 1DPC can restore speed) or mixed DIMM parts
      // (matched parts restore the common speed). A uniform 1-DIMM-per-channel
      // population below its rated speed is the CPU/memory-controller's max for
      // this DIMM/rank config (a platform cap) that no rebalance can raise, so it
      // is benign and must not fire: e.g. EPYC 4004/AM5 caps DDR5 at 5200 while
      // boards ship 5600-rated DIMMs (val 2026-07-15). The raw `downclocked` fact
      // stays in the evidence. A precise CPU-model -> max-MT/s table (follow-up)
      // could catch a genuinely-fixable 1DPC downclock, but that is rare (mostly
      // Intel BIOS) and unobserved on the fleet.
      let maxDimmsPerChannel = 0;
      {
        const perChannel = new Map<string, number>();
        for (const d of t.dimms) {
          if (!d.populated || d.channel === null) continue;
          const key = `${d.socket ?? 0}/${d.channel}`;
          const n = (perChannel.get(key) ?? 0) + 1;
          perChannel.set(key, n);
          if (n > maxDimmsPerChannel) maxDimmsPerChannel = n;
        }
      }
      const actionableDownclock = downclocked && (maxDimmsPerChannel >= 2 || t.mixed_parts === true);
      if (missing <= 0 && !actionableDownclock) return [];

      // Per-socket population breakdown (dual-socket boxes under-populate
      // per CPU; "8 of 16" alone hides that). Sockets default to 0 when
      // the locator carries no socket, collapsing to one bucket.
      const bySocket = new Map<number, { avail: Set<string>; pop: Set<string> }>();
      for (const d of t.dimms) {
        if (d.channel === null) continue;
        const s = d.socket ?? 0;
        let b = bySocket.get(s);
        if (!b) { b = { avail: new Set(), pop: new Set() }; bySocket.set(s, b); }
        b.avail.add(d.channel);
        if (d.populated) b.pop.add(d.channel);
      }
      const perSocket = [...bySocket.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([socket, b]) => ({
          socket,
          available_channels: b.avail.size,
          populated_channels: b.pop.size,
          empty_channels: [...b.avail].filter((c) => !b.pop.has(c)).sort(),
        }));

      // Downclock detail: worst rated-vs-configured pair among populated DIMMs.
      const clocked = t.dimms.filter((d) => d.populated && d.speed_mts !== null && d.configured_mts !== null && d.configured_mts < d.speed_mts);
      const worst = clocked.sort((a, b) => (a.configured_mts! / a.speed_mts!) - (b.configured_mts! / b.speed_mts!))[0];

      // Tier 2 placement analysis (spec CC_SPEC_DIMM_POPULATION_2026-07-04):
      // not just HOW MANY channels, but WHICH. On EPYC, adjacent channel
      // letters share a memory-controller group (pairs on 8-channel
      // Milan/Rome, triplets on 12-channel Genoa/Turin), so 4 DIMMs placed
      // A,B,E,F idle half the controllers and interleave worse than the
      // spread A,C,E,G at the SAME DIMM count. Deliberately conservative:
      // only sockets whose channel count matches a known grouping (8 or 12),
      // only when populated channels double up inside groups while whole
      // groups sit idle, and it only ENRICHES the already-firing alert
      // rather than adding a second alert type (no new false-positive
      // class). Channel letters are board labels, so the guidance points at
      // the board manual instead of dictating exact slots.
      const clustering = perSocket.flatMap((s) => {
        const groupSize = s.available_channels === 8 ? 2 : s.available_channels === 12 ? 3 : 0;
        if (groupSize === 0 || s.populated_channels < 2) return [];
        const bucket = bySocket.get(s.socket)!;
        const avail = [...bucket.avail].sort();
        const groups: string[][] = [];
        for (let i = 0; i < avail.length; i += groupSize) groups.push(avail.slice(i, i + groupSize));
        const idleGroups = groups.filter((g) => g.every((c) => !bucket.pop.has(c)));
        const usedGroups = groups.length - idleGroups.length;
        // Clustered = the populated channels could have covered more groups
        // than they do, and at least one whole controller group is idle.
        const coverable = Math.min(groups.length, s.populated_channels);
        if (idleGroups.length === 0 || usedGroups >= coverable) return [];
        return [{
          socket: s.socket,
          controller_groups: groups.length,
          groups_used: usedGroups,
          idle_groups: idleGroups.map((g) => g.join("")),
        }];
      });

      const parts: string[] = [];
      if (missing > 0) {
        const pct = Math.round((missing / t.available_channels) * 100);
        const socketNote = perSocket.length > 1
          ? ` (${perSocket.map((s) => `socket ${s.socket}: ${s.populated_channels}/${s.available_channels}`).join(", ")})`
          : "";
        parts.push(`${t.populated_channels} of ${t.available_channels} memory channels are populated${socketNote}. Peak memory bandwidth is roughly ${pct}% below what this platform can deliver; memory-bound workloads pay for it directly. Populating the empty channels restores full bandwidth (the board manual lists which slots for your DIMM count).`);
      }
      if (missing > 0 && clustering.length > 0) {
        const c = clustering
          .map((x) => `socket ${x.socket} uses ${x.groups_used} of ${x.controller_groups} memory-controller groups (idle: ${x.idle_groups.join(", ")})`)
          .join("; ");
        parts.push(`Placement compounds it: ${c}. The installed DIMMs appear to double up on adjacent channels (per the typical A-H pairing; confirm against the board manual) rather than spreading one per controller group, which would idle memory controllers and weaken interleaving at the same DIMM count. When adding or rebalancing DIMMs, spread them across groups per the board manual's population table.`);
      }
      if (actionableDownclock && worst) {
        const cause = maxDimmsPerChannel >= 2
          ? "this is a 2-DIMMs-per-channel downclock; rebalancing toward one DIMM per channel can restore the rated speed"
          : "mixed DIMM parts are forcing the slowest common speed; installing matched DIMMs can restore it";
        parts.push(`DIMMs rated ${worst.speed_mts} MT/s are running at ${worst.configured_mts} MT/s: ${cause}.`);
      }

      const title = missing > 0
        ? `Memory channels under-populated: ${t.populated_channels} of ${t.available_channels}`
        : "Memory running below rated speed";

      // Advisory severity (val campaign, gigabyte + asus): the rule is P3 and
      // its own copy says "advisory, not a fault, acknowledge if intentional".
      // Pure under-population is a deliberate config tradeoff -> info (no page).
      // An ACTIONABLE downclock (2DPC or mixed parts) with no missing channels is
      // a fixable perf regression worth a warning. When both, the under-population
      // framing dominates. A non-actionable/platform-cap downclock never reaches
      // here: it was gated out above.
      return [{
        type: "memory_channels_underpopulated",
        severity: missing > 0 ? "info" : "warning",
        title,
        message: parts.join(" "),
        evidence: {
          available_channels: t.available_channels,
          populated_channels: t.populated_channels,
          total_slots: t.total_slots,
          populated_slots: t.populated_slots,
          per_socket: perSocket,
          ...(clustering.length > 0 ? { controller_clustering: clustering } : {}),
          downclocked,
          downclock_actionable: actionableDownclock,
          ...(worst ? { downclock_worst: { locator: worst.locator, rated_mts: worst.speed_mts, configured_mts: worst.configured_mts } } : {}),
          mixed_parts: t.mixed_parts,
        },
        recommendation: "Advisory, not a fault: the host is healthy but leaving memory bandwidth unused. Rebalancing DIMMs is a physical maintenance action; acknowledge if the population is an intentional capacity/cost tradeoff.",
      }];
    },
  },

  // 23.4 zfs_slog_faulted (ZFS C6 split)
  {
    type: "zfs_slog_faulted",
    evaluate(snap) {
      if (!snap.zfs?.pools) return [];
      const faultedSlogs: Array<{ pool: string; vdev: string; state: string }> = [];
      for (const pool of snap.zfs.pools) {
        if (!pool.slog_vdevs) continue;
        for (const slog of pool.slog_vdevs) {
          if (slog.state === "FAULTED" || slog.state === "REMOVED" || slog.state === "UNAVAIL") {
            faultedSlogs.push({ pool: pool.name, vdev: slog.name, state: slog.state });
          }
        }
      }
      if (faultedSlogs.length === 0) return [];
      const detail = faultedSlogs.map((f) => `${f.pool}/${f.vdev} (${f.state})`).join("; ");
      return [{
        type: "zfs_slog_faulted",
        severity: "critical",
        title: `ZFS SLOG faulted: ${detail}`,
        message: `${faultedSlogs.length} ZIL log vdev(s) FAULTED or REMOVED. Sync-write durability for the affected pool(s) is compromised.`,
        evidence: { faulted_slogs: faultedSlogs },
        recommendation: "Replace the failed SLOG device. If mirrored, zpool replace in-place. If single-device, zpool remove then zpool add with the replacement.",
      }];
    },
  },

  // 23. Unattended upgrades disabled
  {
    type: "unattended_upgrades_disabled",
    evaluate(snap) {
      if (!snap.security || snap.security.auto_updates.configured) return [];
      const a = snap.security.auto_updates;
      const hint = a.mechanism === "unattended-upgrades" ? "Make sure unattended-upgrades is installed and the auto-update mechanism is enabled."
        : a.mechanism === "dnf-automatic" ? 'Enable: "sudo systemctl enable --now dnf-automatic-install.timer"'
        : isRhelFamily(snap)
          ? 'Install: "sudo dnf install dnf-automatic" (this host is RHEL-family). Debian/Ubuntu equivalent: "sudo apt install unattended-upgrades".'
          : 'Install: "sudo apt install unattended-upgrades" (Debian/Ubuntu) or "sudo dnf install dnf-automatic" (RHEL/Rocky)';
      return [{
        type: "unattended_upgrades_disabled",
        severity: "warning",
        title: "Automatic security updates not configured",
        message: `${a.details}. Without automatic updates, security patches must be applied manually.`,
        evidence: { mechanism: a.mechanism, details: a.details },
        recommendation: hint,
      }];
    },
  },

  // === OS / firmware currency (advisories) ===
  //
  // os_end_of_life: two-field advisory. Combines the release EOL date (from the
  // synced endoflife.date dataset, held in an in-memory cache) with the host's
  // on-agent extended-support enrollment signal (snap.support_status) so a
  // past-standard-support host that is still enrolled in ESM/EUS is NOT falsely
  // reported unsupported. Severity ceiling is warning (never pages), matching
  // the kernel_vulnerabilities tone. When the support signal is absent (older
  // agent, or a distro/host with no unprivileged enrollment signal, e.g. RHEL
  // without readable EUS repos), it degrades to conservative "enrollment not
  // verified" wording rather than asserting the host is unsupported.
  // Rationale + sourcing: CC_CURRENCY_BUILD_DECISION_2026-07-15.
  {
    type: "os_end_of_life",
    evaluate(snap) {
      const life = lookupLifecycle(snap.system);
      // Unmodelled distro, no cached data yet, or a rolling release with no
      // known EOL: say nothing.
      if (!life || !life.eolFrom) return [];
      const now = new Date();
      const standardEnd = life.eolFrom;
      const extendedEnd = life.eoesFrom; // may be null
      const WARN_WINDOW_MS = 180 * 24 * 3600 * 1000;
      const msToStandard = standardEnd.getTime() - now.getTime();

      // Comfortably within standard support: nothing to surface.
      if (msToStandard > WARN_WINDOW_MS) return [];

      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const osLabel =
        snap.system.os && snap.system.os !== "Unknown"
          ? snap.system.os
          : `${life.product} ${life.cycle}`;
      const ss = snap.support_status;
      const extActive = ss?.extended_support_active; // true | false | null | undefined
      const baseEvidence = {
        product: life.product,
        cycle: life.cycle,
        standard_support_ends: fmt(standardEnd),
        extended_support_ends: extendedEnd ? fmt(extendedEnd) : null,
        extended_support_active: extActive ?? null,
        support_source: ss?.source ?? null,
      };

      // Approaching standard EOL but still supported today (info, no page).
      if (msToStandard > 0) {
        const days = Math.round(msToStandard / (24 * 3600 * 1000));
        return [{
          type: "os_end_of_life",
          severity: "info",
          title: `Standard support for ${osLabel} ends soon`,
          message: `Standard security support for ${osLabel} ends on ${fmt(standardEnd)} (in ${days} days). Plan an OS upgrade${extendedEnd ? `; extended support (ESM/EUS) would then run until ${fmt(extendedEnd)}` : ""}.`,
          evidence: { ...baseEvidence, days_remaining: days },
          recommendation: `Schedule an upgrade to a supported release before ${fmt(standardEnd)}.${extendedEnd ? ` If you cannot upgrade in time, enroll in extended support (Ubuntu Pro/ESM or RHEL ELS) to keep receiving security fixes until ${fmt(extendedEnd)}.` : ""}`,
        }];
      }

      // Past standard EOL. Enrolled and covered -> reassuring info (dashboard
      // only). Otherwise a warning whose wording is honest about what we know.
      if (extActive === true) {
        return [{
          type: "os_end_of_life",
          severity: "info",
          title: `${osLabel} is on extended support`,
          message: `Standard support for ${osLabel} ended on ${fmt(standardEnd)}, but this host is enrolled in extended security support (${ss?.details ?? "ESM/EUS active"})${extendedEnd ? ` until ${fmt(extendedEnd)}` : ""}. It is still receiving security updates; plan the OS upgrade before extended support ends.`,
          evidence: baseEvidence,
          recommendation: `No immediate action: extended support is covering this host. Plan the OS upgrade before ${extendedEnd ? fmt(extendedEnd) : "extended support ends"}.`,
        }];
      }

      const inExtendedWindow = extendedEnd !== null && now.getTime() < extendedEnd.getTime();
      let title: string;
      let message: string;
      let recommendation: string;
      if (inExtendedWindow) {
        title = `${osLabel} past standard support`;
        if (extActive === false) {
          message = `Standard security support for ${osLabel} ended on ${fmt(standardEnd)}. Extended support (ESM/EUS) is available until ${fmt(extendedEnd!)}, but this host is NOT enrolled (${ss?.details ?? "no extended support detected"}), so it is receiving no base-system security updates.`;
          recommendation = `Upgrade the OS, or enroll this host in extended support (Ubuntu Pro/ESM or RHEL ELS) to resume security updates until ${fmt(extendedEnd!)}.`;
        } else {
          message = `Standard security support for ${osLabel} ended on ${fmt(standardEnd)}. Extended support (ESM/EUS) may be available until ${fmt(extendedEnd!)}, but enrollment on this host could not be verified. If it is not enrolled, it is receiving no base-system security updates.`;
          recommendation = `Confirm extended-support enrollment (Ubuntu: "pro security-status"; RHEL: check for enabled EUS/ELS repos). Then upgrade the OS, or enroll to keep receiving security fixes until ${fmt(extendedEnd!)}.`;
        }
      } else {
        // No extended window, or already past extended support: fully EOL.
        const finalEnd = extendedEnd && now.getTime() >= extendedEnd.getTime() ? extendedEnd : standardEnd;
        title = `${osLabel} is end of life`;
        const unknownSuffix = extActive === null || extActive === undefined ? " Extended-support enrollment could not be verified." : "";
        message = `${osLabel} reached end of life on ${fmt(finalEnd)}. It receives no security updates unless under a paid extended-support contract.${unknownSuffix}`;
        recommendation = `Upgrade to a supported release. This OS is past end of life and is accumulating unpatched vulnerabilities.`;
      }
      return [{
        type: "os_end_of_life",
        severity: "warning",
        title,
        message,
        evidence: { ...baseEvidence, in_extended_window: inExtendedWindow },
        recommendation,
      }];
    },
  },

  // bios_firmware_age: an INFORMATIONAL advisory, never a fault. Raw BIOS age
  // is not a "should update" signal (a 3-year-old BIOS may be the newest ever
  // published for that board), so this only nudges the operator to VERIFY
  // against the vendor catalog. Both deep-research passes (2026-07-15) were
  // explicit that BIOS age must not be an action alert; we ship it info-only,
  // VM-guarded, and verification-worded. Escalation above info waits on a real
  // update-availability source (fwupd / Redfish), a later milestone.
  {
    type: "bios_firmware_age",
    evaluate(snap) {
      const dmi = snap.dmi;
      // Bare-metal only: SMBIOS dates on VMs/cloud are placeholders
      // (Google Compute Engine 01/01/2011, VirtualBox 12/01/2006, QEMU
      // "0date"), never a meaningful firmware age.
      if (!dmi?.available || dmi.is_virtual) return [];
      const raw = (dmi.bios_date ?? "").trim();
      // SMBIOS type 0 date is mm/dd/yyyy. Anything else (empty, "0date",
      // "NONE", a 2-digit year) is a placeholder we cannot trust.
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return [];
      const month = parseInt(m[1], 10);
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      const now = new Date();
      // Reject implausible years (firmware predating ~2000, or a future
      // date) as garbage rather than treating them as extremely old.
      if (year < 2000 || year > now.getUTCFullYear() + 1) return [];
      const biosDate = new Date(Date.UTC(year, month - 1, day));
      if (Number.isNaN(biosDate.getTime())) return [];
      const ageMonths = Math.floor(
        (now.getTime() - biosDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
      );
      const THRESHOLD_MONTHS = 24;
      if (ageMonths < THRESHOLD_MONTHS) return [];
      const ageYears = (ageMonths / 12).toFixed(1);
      const vendorHint = dmi.vendor && dmi.vendor !== "unknown" ? ` ${dmi.vendor}` : "";
      const productHint = dmi.product_name ? ` ${dmi.product_name}` : "";
      return [{
        type: "bios_firmware_age",
        severity: "info",
        title: "BIOS firmware metadata is aging",
        message: `This host's BIOS is dated ${raw} (about ${ageYears} years old). Old firmware is not a fault on its own: it may still be the latest release for this board. Treat this as a prompt to verify the current BIOS/UEFI and BMC firmware against the vendor's catalog, not an instruction to update.`,
        evidence: {
          bios_version: dmi.bios_version,
          bios_date: raw,
          age_months: ageMonths,
          vendor: dmi.vendor,
          product_name: dmi.product_name,
        },
        recommendation: `Check${vendorHint}${productHint} for a newer BIOS/UEFI and BMC firmware release. If the installed version is already the latest published for this board, acknowledge this advisory. Firmware updates are disruptive (reboot, possible downtime): schedule a maintenance window and follow the vendor's procedure.`,
      }];
    },
  },

  // === Disk I/O (1) ===

  // 24. Disk I/O errors
  //
  // Two emission paths:
  //   - Legacy: snap.io_errors (Crucible's grep-based dmesg scan).
  //   - C18 activation (2026-05-19): snap.dmesg_events with the
  //     structured scsi_sense + nvme_reset event types. Same severity
  //     (critical); evidence carries the structured fields so the
  //     dashboard surface can render the sense key and the affected
  //     device cleanly.
  //
  // Both paths can fire on the same snapshot if Crucible v0.12.0+ is
  // populating dmesg_events alongside the legacy io_errors. They
  // describe overlapping (sometimes identical) signals; the operator
  // sees both and the FIX content can use the structured fields when
  // present.
  {
    type: "disk_io_errors",
    evaluate(snap) {
      const results: AlertResult[] = [];

      // Resolve kernel-log device names ("sda", "/dev/sda", "sda1", "nvme0",
      // "nvme0n1") against the SMART inventory so provider-facing surfaces
      // (ticket drafts) can name the physical unit (model + serial), not just
      // the node name. Same idea as the raid_degraded member join (#360).
      // A suffix must start a new numeric segment ("sda"~"sda1", "nvme0"~
      // "nvme0n1", "nvme0n1"~"nvme0n1p2") so "sda" cannot match "sdaa".
      const resolveDrives = (names: string[]) => {
        if (!snap.smart || snap.smart.length === 0) return [];
        const norm = (s: string) => String(s).replace(/^\/dev\//, "");
        const segmentMatch = (long: string, short: string) =>
          long.startsWith(short) && /^(\d|n\d|p\d)/.test(long.slice(short.length));
        const matches = (a: string, b: string) => a === b || segmentMatch(a, b) || segmentMatch(b, a);
        const out: Array<{ device: string; model?: string; serial?: string; firmware?: string }> = [];
        for (const name of names) {
          const n = norm(name);
          const hit = snap.smart.find((d) => matches(norm(d.device ?? ""), n));
          if (hit && !out.some((o) => o.device === hit.device)) {
            out.push({ device: hit.device, model: hit.model, serial: hit.serial, firmware: hit.firmware });
          }
        }
        return out;
      };

      // Legacy path.
      if (snap.io_errors && snap.io_errors.count > 0) {
        const devices = snap.io_errors.devices.length > 0 ? snap.io_errors.devices.join(", ") : "unknown";
        results.push({
          type: "disk_io_errors",
          severity: "critical",
          title: `${snap.io_errors.count} I/O error(s) on ${devices}`,
          message: `${snap.io_errors.count} I/O error(s) detected in kernel log on ${devices}. Possible disk failure or controller issue.`,
          evidence: {
            scope: "io_errors_count",
            count: snap.io_errors.count,
            devices: snap.io_errors.devices,
            affected_drives: resolveDrives(snap.io_errors.devices),
            fix_commands: [
              "# Check recent I/O errors in kernel log",
              `dmesg -T | grep -i "I/O error" | tail -20`,
              "",
              `# Check SMART status of affected disk(s)`,
              ...snap.io_errors.devices.map((d) => `smartctl -a /dev/${d}`),
              "",
              "# Check for filesystem errors",
              ...snap.io_errors.devices.map((d) => `mount | grep ${d}`),
            ],
          },
          recommendation: `I/O errors indicate failing storage hardware. Check SMART status immediately. If errors persist, plan disk replacement to prevent data loss. ${OWNERSHIP_REMEDIATION_NOTE}`,
        });
      }

      // C18 path: structured SCSI sense + NVMe reset events.
      if (snap.dmesg_events?.available) {
        for (const ev of snap.dmesg_events.events) {
          if (ev.event_type === "scsi_sense") {
            const senseKey = String(ev.details.sense_key ?? "");
            const device = String(ev.details.device ?? "unknown");
            const severityMajor =
              senseKey === "Medium Error" ||
              senseKey === "Hardware Error" ||
              senseKey === "Aborted Command";
            results.push({
              type: "disk_io_errors",
              severity: severityMajor ? "critical" : "warning",
              title: `SCSI sense: ${senseKey} on ${device}`,
              message: `Kernel reported SCSI ${senseKey} on /dev/${device}. ${severityMajor ? "Strong hardware-fault signal" : "Recoverable error but worth tracking"}; cross-check SMART status.`,
              evidence: {
                scope: "scsi_sense",
                device,
                sense_key: senseKey,
                affected_drives: resolveDrives([device]),
                dmesg_timestamp: ev.timestamp_iso,
                raw_line: ev.raw_line,
              },
              recommendation: `Read SMART for the device: \`sudo smartctl -a /dev/${device}\`. Pair with disk_io_errors timeline. ${severityMajor ? "Medium / Hardware / Aborted Command sense keys on the same device repeatedly is a strong replacement signal." : "Recovered Error and Unit Attention are common; only escalate if frequency increases."}${severityMajor ? " " + OWNERSHIP_REMEDIATION_NOTE : ""}`,
            });
          } else if (ev.event_type === "nvme_reset") {
            const controller = String(ev.details.controller ?? "unknown");
            const action = String(ev.details.action ?? "reset");
            results.push({
              type: "disk_io_errors",
              severity: "critical",
              title: `NVMe controller ${controller} ${action}`,
              message: `Kernel reset the NVMe controller ${controller} (action: ${action}). Indicates I/O timeout or controller fault; data path interrupted briefly.`,
              evidence: {
                scope: "nvme_reset",
                controller,
                action,
                affected_drives: resolveDrives([controller]),
                dmesg_timestamp: ev.timestamp_iso,
                raw_line: ev.raw_line,
              },
              recommendation: `Check NVMe SMART: \`sudo smartctl -a /dev/${controller}\`. Look for critical_warning byte (see nvme_critical_warning rule). Recurring resets on the same controller are a replacement signal. ${OWNERSHIP_REMEDIATION_NOTE}`,
            });
          }
        }
      }

      return results;
    },
  },

  // === ZFS (2) ===

  // 25. ZFS pool unhealthy
  //
  // Severity matrix per CC_SPEC_FORGE_C1_C6_DEFERRED_TUNES §2.2,
  // mapped onto the evaluator's three-level severity (critical /
  // warning / info):
  //
  //   pool SUSPENDED                                   -> critical
  //   any top-level vdev FAULTED                       -> critical
  //   vdev DEGRADED on single / stripe                 -> critical
  //   vdev DEGRADED on raidz1 / mirror_2way            -> critical
  //   vdev DEGRADED on raidz2 (no spare in progress)   -> critical
  //   vdev DEGRADED on raidz2 (spare in progress)      -> warning
  //   vdev DEGRADED on raidz3 / mirror_3way+           -> warning
  //   vdev OFFLINE (administrative)                    -> info
  //   l2arc FAULTED                                    -> info
  //   SLOG faulted/removed                             -> NOT emitted
  //     (zfs_slog_faulted rule covers this; PR #159).
  //
  // Capability gating: if Crucible v0.10.4+ has not yet shipped the
  // per-vdev metadata (pool.vdevs is absent), the rule falls back
  // to the original uniform-DEGRADED-emits-critical behavior and
  // tags evidence with parser_quality: "legacy_uniform".
  {
    type: "zfs_pool_unhealthy",
    evaluate(snap) {
      if (!snap.zfs?.pools) return [];
      const results: AlertResult[] = [];

      for (const pool of snap.zfs.pools) {
        // SUSPENDED dominates per-vdev signals - pool I/O has stopped.
        if (pool.state === "SUSPENDED") {
          results.push(buildZfsPoolEmission(pool, {
            severity: "critical",
            scope: "pool",
            reason: "pool I/O suspended",
          }));
          continue;
        }

        // Per-vdev classification (Crucible v0.10.4+ shape).
        if (pool.vdevs && pool.vdevs.length > 0) {
          for (const vdev of pool.vdevs) {
            const verdict = classifyZfsVdev(vdev);
            if (!verdict) continue;
            results.push(buildZfsPoolEmission(pool, {
              severity: verdict.severity,
              scope: "vdev",
              reason: verdict.reason,
              vdev,
            }));
          }
        } else if (pool.state !== "ONLINE") {
          // Pre-0.10.4 fallback: emit once per non-ONLINE pool.
          const isCritical = pool.state === "FAULTED" || pool.state === "UNAVAIL";
          results.push(buildZfsPoolEmission(pool, {
            severity: isCritical ? "critical" : "warning",
            scope: "pool_legacy",
            reason: `pool ${pool.state} (no vdev metadata; upgrade Crucible to v0.10.4+ for per-vdev severity)`,
          }));
        }

        // L2ARC FAULTED: info-only (cache layer; no data loss).
        if (pool.l2arc_vdevs) {
          for (const l2 of pool.l2arc_vdevs) {
            if (l2.state === "FAULTED" || l2.state === "REMOVED" || l2.state === "UNAVAIL") {
              results.push(buildZfsPoolEmission(pool, {
                severity: "info",
                scope: "l2arc",
                reason: "l2arc cache vdev failed (no data loss; performance ticket)",
                l2arc: l2,
              }));
            }
          }
        }

        // SLOG: NOT emitted; zfs_slog_faulted owns it.
      }
      return results;
    },
  },

  // 26. ZFS scrub errors
  {
    type: "zfs_scrub_errors",
    evaluate(snap) {
      if (!snap.zfs?.pools) return [];
      const results: AlertResult[] = [];
      for (const pool of snap.zfs.pools) {
        if (pool.scrub_errors && pool.scrub_errors > 0) {
          results.push({
            type: "zfs_scrub_errors",
            severity: "warning",
            title: `ZFS pool "${pool.name}" scrub found ${pool.scrub_errors} error(s)`,
            message: `ZFS pool "${pool.name}" last scrub found ${pool.scrub_errors} error(s), repaired ${pool.scrub_repaired || "0B"}.`,
            evidence: { pool: pool.name, scrub_errors: pool.scrub_errors, scrub_repaired: pool.scrub_repaired },
            recommendation: `Run "zpool status -v" to identify affected files. Consider replacing the failing disk. Run another scrub after replacement to verify data integrity.`,
          });
        } else if (pool.scrub_never_run) {
          results.push({
            type: "zfs_scrub_errors",
            severity: "warning",
            title: `ZFS pool "${pool.name}" has never been scrubbed`,
            message: `ZFS pool "${pool.name}" has never been scrubbed. Regular scrubs detect silent data corruption before it causes data loss.`,
            evidence: { pool: pool.name, scrub_never_run: true },
            recommendation: `Start a scrub with "sudo zpool scrub ${pool.name}". Schedule monthly scrubs via cron.`,
          });
        } else if (pool.last_scrub_date) {
          const lastScrub = new Date(pool.last_scrub_date);
          const daysSince = (Date.now() - lastScrub.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince > 30) {
            results.push({
              type: "zfs_scrub_errors",
              severity: "warning",
              title: `ZFS pool "${pool.name}" last scrubbed ${Math.floor(daysSince)} days ago`,
              message: `ZFS pool "${pool.name}" last scrubbed ${Math.floor(daysSince)} days ago. Recommended: monthly scrubs to catch silent data corruption.`,
              evidence: { pool: pool.name, days_since_scrub: Math.floor(daysSince), last_scrub: pool.last_scrub_date },
              recommendation: `Start a scrub with "sudo zpool scrub ${pool.name}". Schedule monthly scrubs via cron.`,
            });
          }
        }
      }
      return results;
    },
  },
  // === New OS/Resource Rules (6) ===

  // 27. Conntrack table exhaustion
  //
  // 2026-05-18 audit TUNE: thresholds bumped 75/90 -> 80/95 per
  // HashiCorp KB vendor-anchor (RULE_AUDIT_VERDICTS_2026-05-18.md §3.16).
  // 2026-05-19 C9 activation: insert_failed_rate supplementary signal
  // added per CC_SPEC_FORGE_C7_C10_ACTIVATION §3. High insert_failed
  // rate at moderate utilization indicates rapid table churn (short-
  // lived connections exhausting slots faster than they expire).
  {
    type: "conntrack_exhaustion",
    evaluate(snap) {
      if (!snap.conntrack?.available) return [];
      const ct = snap.conntrack;
      const pct = ct.percent;
      const insertFailedRate = ct.insert_failed_rate_per_sec ?? null;

      // Primary trigger: utilization thresholds (existing path).
      if (pct >= 80) {
        const isCritical = pct >= 95;
        return [{
          type: "conntrack_exhaustion",
          severity: isCritical ? "critical" : "warning",
          title: `Conntrack table at ${pct.toFixed(1)}%`,
          message: `Conntrack table at ${pct.toFixed(1)}% (${ct.count.toLocaleString()} / ${ct.max.toLocaleString()}). ${isCritical ? "Critical threshold: 95%. New connections will be dropped at 100%." : "Warning threshold: 80%."}`,
          evidence: {
            count: ct.count,
            max: ct.max,
            percent: pct,
            ...(ct.insert_failed_total != null
              ? { insert_failed_total: ct.insert_failed_total }
              : {}),
            ...(insertFailedRate !== null
              ? { insert_failed_rate_per_sec: insertFailedRate }
              : {}),
          },
          recommendation: "Connection tracking table is filling up. When it reaches 100%, all new connections are silently dropped. Increase nf_conntrack_max or reduce connection timeouts. Check for long-lived idle connections consuming entries.",
        }];
      }

      // Supplementary trigger: high insert_failed rate at moderate
      // utilization (rapid table churn). Capability-gated: only fires
      // when Crucible v0.11.0+ ships the rate field.
      // Threshold: 10 failed inserts per second is non-trivial; legit
      // steady state should be near zero.
      if (insertFailedRate !== null && insertFailedRate > 10) {
        return [{
          type: "conntrack_exhaustion",
          severity: "warning",
          title: `Conntrack insert_failed rate ${insertFailedRate.toFixed(1)}/s (table at ${pct.toFixed(1)}%)`,
          message: `${insertFailedRate.toFixed(1)} insert_failed events per second despite table at only ${pct.toFixed(1)}% utilization. Likely short-lived connection churn exhausting slots faster than they expire.`,
          evidence: {
            count: ct.count,
            max: ct.max,
            percent: pct,
            insert_failed_total: ct.insert_failed_total,
            insert_failed_rate_per_sec: insertFailedRate,
            note: "Supplementary signal: high insert_failed rate at moderate utilization indicates table churn.",
          },
          recommendation: "Connection tracking table churning. Identify the source of short-lived connections (e.g. healthcheck loops, port scans). Consider raising nf_conntrack_max if growth is legitimate, or applying NOTRACK rules to the high-churn traffic flow.",
        }];
      }

      return [];
    },
  },

  // 28. Systemd service failures
  //
  // Surfaces the last 5 journal lines from each failed unit in
  // `evidence.journal_excerpts[unit]` when Crucible 0.9.2+ ships them.
  // Pre-0.9.2 agents omit the field; the dashboard can show a
  // "(journal excerpt unavailable - upgrade Crucible)" prompt when
  // empty. Codex experiment 2026-05-12 found this rule's biggest gap
  // is the seam between "service failed" and "what went wrong" -
  // the journal excerpt fills it without the customer needing to
  // SSH to the box.
  {
    type: "systemd_service_failed",
    evaluate(snap) {
      if (!snap.systemd || snap.systemd.failed_count <= 0) return [];
      const units = snap.systemd.failed_units;
      const journalExcerpts = snap.systemd.journal_excerpts ?? {};
      const unitList = units.join(", ");
      const fixCmds: string[] = [];
      for (const unit of units) {
        fixCmds.push(
          `# Check status of ${unit}`,
          `sudo systemctl status ${unit}`,
          `sudo journalctl -u ${unit} --no-pager -n 50`,
          "",
          `# Restart ${unit}`,
          `sudo systemctl restart ${unit}`,
          "",
          `# If ${unit} is a one-shot/transient unit (nothing to restart),`,
          `# clear the failed state instead:`,
          `# sudo systemctl reset-failed ${unit}`,
          "",
        );
      }
      // Compose a per-unit evidence map: { unit_name: [last 5 journal
      // lines] }. Empty array when Crucible didn't send anything for
      // that unit (older agent, or the unit's logs were unreadable).
      const journal_excerpts: Record<string, string[]> = {};
      for (const unit of units) {
        journal_excerpts[unit] = Array.isArray(journalExcerpts[unit]) ? journalExcerpts[unit] : [];
      }
      // C12 activation (2026-05-19): include failed_unit_details
      // (Result + ActiveState + NRestarts per unit) in evidence so the
      // alert card can render the reason without an SSH round-trip.
      // Capability-gated: pre-0.12.0 agents have no failed_unit_details
      // and the field stays absent from evidence.
      const detailsByUnit = snap.systemd.failed_unit_details;
      return [{
        type: "systemd_service_failed",
        severity: "critical",
        title: `${units.length} systemd service${units.length > 1 ? "s" : ""} failed`,
        message: `${units.length} systemd service${units.length > 1 ? "s" : ""} in failed state: ${unitList}`,
        evidence: {
          failed_units: units,
          failed_count: units.length,
          journal_excerpts,
          ...(detailsByUnit
            ? { failed_unit_details: detailsByUnit }
            : {}),
          fix_commands: fixCmds,
        },
        recommendation: "One or more systemd units have failed. Check the cause with `journalctl -u <unit> -e`, then restart it, OR run `sudo systemctl reset-failed <unit>` for a Type=oneshot unit that has already done its job (restarting a oneshot just re-runs and re-fails). For a long-running service, `Restart=on-failure` in the unit enables automatic recovery. A failed .mount means a filesystem is not mounted: fix /etc/fstab or the device before remounting.",
      }];
    },
  },

  // 28b. systemd_service_oom_killed (C12 activation, 2026-05-19).
  //
  // Specific severity branch for OOM-killed services. Subordinate to
  // oom_kills (host-level rule); when both fire on the same host,
  // runtime subordination collapses this under oom_kills as evidence.
  //
  // Capability-gated on snap.systemd.failed_unit_details (Crucible
  // v0.12.0+). Pre-0.12.0 hosts see no emission.
  {
    type: "systemd_service_oom_killed",
    evaluate(snap) {
      const details = snap.systemd?.failed_unit_details;
      if (!details) return [];
      const results: AlertResult[] = [];
      for (const [unitName, d] of Object.entries(details)) {
        if (d.result !== "oom-kill") continue;
        results.push({
          type: "systemd_service_oom_killed",
          severity: "critical",
          title: `${unitName} killed by OOM`,
          message: `systemd reports ${unitName} failed with Result=oom-kill. The kernel OOM killer terminated this service to reclaim memory. Often correlated with a host-level oom_kills emission; the parent rule names the host while this rule names the specific service.`,
          evidence: {
            unit_name: unitName,
            result: d.result,
            active_state: d.active_state,
            sub_state: d.sub_state,
            n_restarts: d.n_restarts,
          },
          recommendation: `Inspect memory pressure context first: \`cat /proc/pressure/memory\` for PSI history. Check the unit's MemoryHigh / MemoryMax (\`systemctl cat ${unitName}\`); if those are too tight for the workload, raise them. If the OOM was host-level, follow the oom_kills rule's remediation; this service was the casualty.`,
        });
      }
      return results;
    },
  },

  // 28c. service_flapping (C12 activation, 2026-05-19).
  //
  // Fires when systemd reports start-limit-hit OR when NRestarts is
  // unusually high. start-limit-hit is the canonical "I gave up
  // restarting" signal from systemd's StartLimitBurst / IntervalSec.
  // NRestarts >= 5 catches services in active restart cycles before
  // systemd's limiter has caught them.
  //
  // Spec proposed cross-snapshot library tracking; the C12 NRestarts
  // field is itself cumulative and surfaces the signal per-snapshot,
  // so cross-snapshot orchestration isn't required for v1. If FP rate
  // is high (services with legitimate high restart counts), the
  // threshold can move to a config override or a sustained-window
  // version added later.
  {
    type: "service_flapping",
    // Important: this rule reads from snap.systemd.failed_unit_details
    // which CURRENTLY only contains units in failed ActiveState. A
    // genuinely-flapping unit (Restart=always, fast cycle) spends most
    // of each cycle in active state and only briefly transitions
    // through failed; at any random 5-min snapshot the probability of
    // catching it in failed state is ~3-25%. The rule logic below is
    // correct - it fires on n_restarts >= 5 regardless of state - but
    // the data Crucible currently provides under-reports flapping.
    //
    // Fix is on the Crucible side: extend failed_unit_details to
    // include any unit with n_restarts >= 3 even when currently
    // active. Spec at ~/Documents/Glassmkr/crucible deep dive/
    // CC_generated/CC_SPEC_CRUCIBLE_FLAPPING_UNIT_DETECTION_2026-05-20.md.
    // Post-spec Crucible (>= the release that ships the change) will
    // populate the field broadly and this rule will catch flapping
    // units consistently.
    //
    // Discovered: campaign cycle 2 on val-mz62hd 2026-05-20.
    evaluate(snap) {
      const details = snap.systemd?.failed_unit_details;
      if (!details) return [];
      const results: AlertResult[] = [];
      for (const [unitName, d] of Object.entries(details)) {
        const flapping =
          d.result === "start-limit-hit" || (d.n_restarts ?? 0) >= 5;
        if (!flapping) continue;
        const severity = d.result === "start-limit-hit" ? "critical" : "warning";
        results.push({
          type: "service_flapping",
          severity,
          title: `${unitName} flapping (${d.n_restarts} restart${d.n_restarts === 1 ? "" : "s"})`,
          message: `${unitName} has restarted ${d.n_restarts} times${d.result === "start-limit-hit" ? " and systemd has stopped restarting it (start-limit-hit)" : ""}. A service that can't stabilise is usually consuming resources without delivering value; investigate before bumping the restart limit.`,
          evidence: {
            unit_name: unitName,
            result: d.result,
            n_restarts: d.n_restarts,
            active_state: d.active_state,
            sub_state: d.sub_state,
          },
          recommendation: `Examine why ${unitName} keeps failing: \`journalctl -u ${unitName} --since='-1h' --no-pager | tail -100\`. Common causes: misconfiguration (recent edit), upstream dependency unreachable, resource limit too tight, transient external state the service can't tolerate. Bumping StartLimitBurst / IntervalSec is a workaround, not a fix.`,
        });
      }
      return results;
    },
  },

  // 28d. lvm_thinpool_metadata_high (C14 activation, 2026-05-19).
  //
  // LVM thin pool metadata exhaustion is silent and catastrophic;
  // writes fail unpredictably across all thin volumes in the pool
  // when metadata fills. Critical at >=95%, warning at >=80%.
  //
  // Capability-gated on snap.lvm (Crucible v0.12.0+; absent on hosts
  // without LVM thin pools or without the lvs binary).
  {
    type: "lvm_thinpool_metadata_high",
    evaluate(snap) {
      if (!snap.lvm?.available || snap.lvm.thin_pools.length === 0) return [];
      const results: AlertResult[] = [];
      for (const pool of snap.lvm.thin_pools) {
        if (pool.metadata_percent < 80) continue;
        const isCritical = pool.metadata_percent >= 95;
        results.push({
          type: "lvm_thinpool_metadata_high",
          severity: isCritical ? "critical" : "warning",
          title: `LVM thin pool ${pool.vg_name}/${pool.lv_name} metadata at ${pool.metadata_percent.toFixed(1)}%`,
          message: `LVM thin pool ${pool.vg_name}/${pool.lv_name} metadata volume is at ${pool.metadata_percent.toFixed(1)}% (data at ${pool.data_percent.toFixed(1)}%). ${isCritical ? "Metadata exhaustion is imminent; writes across all thin volumes in this pool will start failing in unpredictable ways at 100%." : "Plan to extend the metadata volume before it fills."}`,
          evidence: {
            lv_name: pool.lv_name,
            vg_name: pool.vg_name,
            metadata_percent: pool.metadata_percent,
            data_percent: pool.data_percent,
            ...(isCritical ? { severity_reason: "metadata exhaustion imminent" } : {}),
          },
          recommendation: `Extend the thin pool metadata volume: \`sudo lvextend --poolmetadatasize +<SIZE> ${pool.vg_name}/${pool.lv_name}\`. Metadata sizing is per-volume; common safe target is 0.5% to 1% of data volume size. After extending, verify with \`lvs --options=lv_name,vg_name,data_percent,metadata_percent\`.`,
        });
      }
      return results;
    },
  },

  // 28e. nvme_critical_warning (C17 activation, 2026-05-19).
  //
  // Any non-zero bit in the NVMe Critical Warning byte is per NVM
  // Express spec §5.21 a vendor-recommended immediate-action signal.
  // Always critical; the rule lists which flags are active so the
  // operator can triage (spare-low vs temperature vs read-only).
  //
  // Capability-gated on snap.smart[].critical_warning_decoded
  // (Crucible v0.12.0+ for NVMe devices).
  {
    type: "nvme_critical_warning",
    evaluate(snap) {
      if (!snap.smart) return [];
      const results: AlertResult[] = [];
      for (const dev of snap.smart) {
        const decoded = dev.critical_warning_decoded;
        if (!decoded) continue;
        const activeFlags = Object.entries(decoded)
          .filter(([, v]) => v === true)
          .map(([k]) => k);
        if (activeFlags.length === 0) continue;
        results.push({
          type: "nvme_critical_warning",
          severity: "critical",
          title: `NVMe ${dev.device} critical warning: ${activeFlags.join(", ")}`,
          message: `${dev.device} (${dev.model}) reports a non-zero Critical Warning byte (raw 0x${(dev.critical_warning_raw ?? 0).toString(16)}). Active flags: ${activeFlags.join(", ")}. Per NVM Express spec §5.21, any non-zero bit is a vendor-recommended immediate-action signal.`,
          evidence: {
            device: dev.device,
            model: dev.model,
            serial: dev.serial,
            firmware: dev.firmware,
            critical_warning_raw: dev.critical_warning_raw,
            flags_active: activeFlags,
            decoded,
            ...(dev.nvme_available_spare != null
              ? { available_spare_percent: dev.nvme_available_spare }
              : {}),
            ...(dev.nvme_available_spare_threshold != null
              ? { available_spare_threshold: dev.nvme_available_spare_threshold }
              : {}),
          },
          recommendation: (decoded.read_only
            ? `Device is in read-only mode; data is preserved but no further writes will land. Plan immediate replacement; the drive's controller has put it in a protective state. Back up via the read-only path before swap.`
            : decoded.temperature_threshold
              ? `Device exceeded its operating temperature threshold. Inspect cooling / airflow; sustained over-temperature accelerates wear and may push it to read-only. Investigate chassis temperatures via IPMI.`
              : decoded.reliability_degraded
                ? `Reliability degraded flag is vendor-specific but typically reflects internal media health below threshold. Plan replacement; data may still be readable but failure is forecast.`
                : decoded.available_spare_low
                  ? `Available spare blocks below the device's threshold. Plan replacement before remaining spare exhausts; NVMe SSDs at this stage are nearing end-of-life.`
                  : `Inspect the device's vendor-specific telemetry: \`sudo smartctl -a ${dev.device}\`. Critical Warning byte is the device telling you something is wrong; the active flags above indicate what.`)
            + " " + OWNERSHIP_REMEDIATION_NOTE,
        });
      }
      return results;
    },
  },

  // 28f. softnet_drops (C16 activation, 2026-05-19).
  //
  // /proc/net/softnet_stat column 2 (input_queue_dropped) sums non-
  // zero when the kernel's NET_RX softirq queue overflowed. Indicates
  // either receive-side processing bottleneck or intentional kernel-
  // layer traffic shaping. >10/s emits critical; >1/s emits warning.
  //
  // Capability-gated on snap.softnet.total_dropped_rate_per_sec
  // (Crucible v0.12.0+).
  {
    type: "softnet_drops",
    boot_grace_seconds: 300,
    evaluate(snap) {
      if (!snap.softnet?.available) return [];
      const rate = snap.softnet.total_dropped_rate_per_sec;
      if (rate == null) return []; // first snapshot
      if (rate <= 1) return [];
      const severity: AlertResult["severity"] = rate > 10 ? "critical" : "warning";
      return [{
        type: "softnet_drops",
        severity,
        title: `Kernel softnet dropping ${rate.toFixed(1)} pkt/s`,
        message: `/proc/net/softnet_stat reports ${rate.toFixed(2)} input-queue drops per second across CPUs. The NET_RX softirq backlog is filling faster than the kernel can process; packets are being silently discarded.`,
        evidence: {
          total_dropped_rate_per_sec: rate,
          total_dropped_cumulative: snap.softnet.total_dropped_cumulative,
          per_cpu_dropped: snap.softnet.per_cpu_dropped,
        },
        recommendation: `Softnet drops usually correlate with one of: high traffic volume from a single source CPU's queue (RPS/RSS misconfiguration concentrating traffic on one CPU), CPU pressure preventing softirq handling (check cpu_pressure_high), or a runaway interrupt source. Check per-CPU drops to find which CPU is hot, then \`mpstat -P ALL 1 5\` to see whether that CPU's softirq% is saturated.`,
      }];
    },
  },

  // 29. NTP not synchronized
  //
  // Two-tier severity:
  //   - Clock not synchronized  -> CRITICAL. The system time is actually wrong.
  //   - Daemon stopped, clock still synced -> WARNING. Protection lost, drift
  //     has not accumulated yet.
  //
  // Ordering matters: synced=false takes precedence, so a stopped daemon with
  // a drifted clock reports as critical.
  {
    type: "ntp_not_synced",
    boot_grace_seconds: 300,
    evaluate(snap) {
      if (!snap.ntp) return [];
      if (!snap.ntp.synced) {
        const source = snap.ntp.source || "none";
        return [{
          type: "ntp_not_synced",
          severity: "critical",
          title: "Clock is not synchronized",
          message: snap.ntp.daemon_running
            ? `Time sync daemon (${source}) is running but the kernel clock is not synchronized. System time is drifting.`
            : "No NTP daemon is running and the kernel clock is not synchronized. System time is drifting.",
          evidence: { source, synced: false, daemon_running: snap.ntp.daemon_running, daemon_name: snap.ntp.daemon_name },
          recommendation: "Unsynchronized clocks break TLS validation, database replication, log correlation, and cron scheduling. Start the time daemon (the unit name varies by distro: `chronyd` on RHEL/Rocky/Alma, `chrony` on Debian/Ubuntu, or `systemd-timesyncd`), e.g. `sudo systemctl enable --now chronyd 2>/dev/null || sudo systemctl enable --now chrony`, and confirm with `timedatectl status`.",
        }];
      }
      if (!snap.ntp.daemon_running) {
        return [{
          type: "ntp_not_synced",
          severity: "warning",
          title: "NTP daemon stopped, clock will drift",
          message: "The kernel clock is still reported as synchronized, but no NTP daemon is running. The clock will drift once kernel state expires or the server reboots.",
          evidence: { source: snap.ntp.source || "none", synced: true, daemon_running: false, daemon_name: snap.ntp.daemon_name },
          recommendation: "Start and enable an NTP daemon: `sudo systemctl enable --now chrony` (recommended) or `sudo systemctl enable --now systemd-timesyncd`. Without a running daemon, time protection is lost even if the kernel still reports synchronized.",
        }];
      }
      return [];
    },
  },

  // 30. Swap usage high
  {
    type: "swap_high",
    evaluate(snap) {
      if (!snap.memory?.swap_total_mb || snap.memory.swap_total_mb === 0) return [];
      // C3 activation (2026-05-19): primary trigger is pswpin rate when
      // available, since cumulative swap-used can sit high after a
      // historical spike without indicating current pressure. The
      // pattern library threshold is "2% of total memory swapped in
      // per 5-min window."
      const pswpinRate = snap.vmstat?.pswpin_rate;
      if (typeof pswpinRate === "number" && pswpinRate > 0) {
        const totalKb = (snap.memory.total_mb ?? 0) * 1024;
        const fivMinWindow = pswpinRate * 300; // pages/sec → pages over 5 min
        // 4 KB pages; convert to kB.
        const swappedInKb = fivMinWindow * 4;
        const pctOfMemory = totalKb > 0 ? (swappedInKb / totalKb) * 100 : 0;
        if (pctOfMemory >= 2) {
          return [{
            type: "swap_high",
            severity: pctOfMemory >= 10 ? "critical" : "warning",
            title: `Active swap-in: ${pctOfMemory.toFixed(1)}% of RAM per 5-min`,
            message: `Swap-in rate is ${pswpinRate.toFixed(0)} pages/sec; over 5 minutes that's ${pctOfMemory.toFixed(1)}% of total memory paged in. The host is actively thrashing.`,
            evidence: {
              pswpin_rate: pswpinRate,
              pswpin_pct_of_memory_per_5min: pctOfMemory,
              swap_used_mb: snap.memory.swap_used_mb,
              swap_total_mb: snap.memory.swap_total_mb,
              trigger: "pswpin_rate",
            },
            recommendation: "The host is paging actively. Identify the memory-hungry process; restart or scale it. Persistent swap-in indicates physical RAM is undersized for the workload.",
          }];
        }
        // pswpin rate exists but is below threshold - don't fire.
        return [];
      }
      // Fallback: absolute swap% (legacy behavior; pre-Crucible-0.10.4
      // agents and hosts where /proc/vmstat is unreadable).
      const pct = (snap.memory.swap_used_mb / snap.memory.swap_total_mb) * 100;
      if (pct < 50) return [];
      const isCritical = pct >= 80;
      return [{
        type: "swap_high",
        severity: isCritical ? "critical" : "warning",
        title: `Swap usage at ${pct.toFixed(1)}%`,
        message: `Swap usage at ${pct.toFixed(1)}% (${fmtMB(snap.memory.swap_used_mb)} / ${fmtMB(snap.memory.swap_total_mb)}). ${isCritical ? "Critical: server is likely thrashing." : "Warning threshold: 50%."} (Upgrade Crucible to v0.10.4+ for active-paging detection via pswpin rate.)`,
        evidence: {
          swap_used: snap.memory.swap_used_mb,
          swap_total: snap.memory.swap_total_mb,
          percent: Math.round(pct * 10) / 10,
          trigger: "legacy_absolute_swap_percent",
        },
        recommendation: "High swap usage indicates the server is running out of physical RAM. Swap I/O is 10-100x slower than RAM. Identify the memory-hungry process and either increase RAM, reduce workload, or fix the memory leak.",
      }];
    },
  },

  // 31. File descriptor exhaustion
  //
  // Two emission paths:
  //   - System-wide: /proc/sys/fs/file-nr near fs.file-max (existing).
  //   - Per-process (C7 activation 2026-05-19): a process within 80%
  //     (warning) or 95% (critical) of its RLIMIT_NOFILE soft limit.
  //     Crucible v0.11.0+ ships snap.process_fd; capability-gated.
  //
  // Per pattern library Cat 8: a leaky daemon hits LimitNOFILE long
  // before fs.file-max; the system-wide path alone misses this.
  {
    type: "fd_exhaustion",
    evaluate(snap) {
      const results: AlertResult[] = [];

      // Host-wide path (existing).
      if (snap.file_descriptors && snap.file_descriptors.max > 0) {
        const pct = snap.file_descriptors.percent;
        if (pct >= 80) {
          const isCritical = pct >= 95;
          results.push({
            type: "fd_exhaustion",
            severity: isCritical ? "critical" : "warning",
            title: `File descriptors at ${pct.toFixed(1)}%`,
            message: `File descriptor usage at ${pct.toFixed(1)}% (${snap.file_descriptors.allocated.toLocaleString()} / ${snap.file_descriptors.max.toLocaleString()}). ${isCritical ? "Critical: processes will fail to open files or sockets." : "Warning threshold: 80%."}`,
            evidence: {
              scope: "host_wide",
              allocated: snap.file_descriptors.allocated,
              max: snap.file_descriptors.max,
              percent: pct,
            },
            recommendation: "System-wide file descriptor usage is high. When the limit is reached, processes cannot open new files or sockets, causing crashes and connection failures. Increase fs.file-max or identify processes leaking file descriptors.",
          });
        }
      }

      // Per-process path (C7).
      //
      // Deliberately-hardened soft limits (campaign finding 2026-05-20,
      // observed on val-RTXA4000 under OpenSSH 10.0p2): OpenSSH 9.8+ sets
      // RLIMIT_NOFILE=1 on sshd-auth/sshd-session privsep children AFTER
      // those stages open the handful of fds they need. The kernel doesn't
      // retroactively close already-open fds, and the hardened child doesn't
      // grow its fd set, so "6 fds / soft limit 1 = 600%" is technically
      // accurate but operationally a permanent false positive: the alert
      // re-fires every snapshot until the host reboots. Other hardened
      // daemons follow the same pattern (open-then-drop).
      //
      // The OS default soft limit is 1024 (Linux), so any value below the
      // floor below is categorically intentional hardening. Skip; rely on
      // the host-wide path for genuine system-level FD exhaustion.
      const HARDENED_SOFT_LIMIT_FLOOR = 16;
      if (snap.process_fd?.available && snap.process_fd.top_consumers.length > 0) {
        for (const proc of snap.process_fd.top_consumers) {
          if (proc.percent_of_soft_limit < 80) continue;
          // Skip processes with soft limit 0 (the "unlimited" sentinel
          // per Crucible's parseOpenFilesLimit). Their percent is always
          // 0 anyway but guard explicitly.
          if (proc.rlimit_nofile_soft === 0) continue;
          // Skip deliberately-hardened soft limits (see comment above).
          if (proc.rlimit_nofile_soft < HARDENED_SOFT_LIMIT_FLOOR) continue;
          const isCritical = proc.percent_of_soft_limit >= 95;
          results.push({
            type: "fd_exhaustion",
            severity: isCritical ? "critical" : "warning",
            title: `Process ${proc.comm} (pid ${proc.pid}) at ${proc.percent_of_soft_limit.toFixed(1)}% of FD soft limit`,
            message: `${proc.comm} (pid ${proc.pid}) holds ${proc.fd_count} open file descriptors, ${proc.percent_of_soft_limit.toFixed(1)}% of its RLIMIT_NOFILE soft limit (${proc.rlimit_nofile_soft}). ${isCritical ? "Critical: process will fail open() / accept() at 100%." : "Warning threshold: 80%."}`,
            evidence: {
              scope: "per_process",
              pid: proc.pid,
              comm: proc.comm,
              fd_count: proc.fd_count,
              rlimit_nofile_soft: proc.rlimit_nofile_soft,
              rlimit_nofile_hard: proc.rlimit_nofile_hard,
              percent_of_soft_limit: proc.percent_of_soft_limit,
            },
            recommendation: `Process ${proc.comm} (pid ${proc.pid}) is near its RLIMIT_NOFILE. Inspect with \`ls -l /proc/${proc.pid}/fd | wc -l\` and \`cat /proc/${proc.pid}/limits\`. If legitimate, raise LimitNOFILE in the systemd unit (or equivalent supervisor config). If unexpected, look for a file descriptor leak.`,
          });
        }
      }

      return results;
    },
  },

  // 32. Unexpected reboot detected
  {
    type: "unexpected_reboot",
    evaluate(snap) {
      // This rule compares current uptime against previous snapshot.
      // Since we only get a single snapshot, we rely on the server-side
      // evaluateAlertsWithHistory() for the cross-snapshot comparison.
      // This stub exists to keep the rule registered for muting/config purposes.
      return [];
    },
  },

  // === GPU rules (C19 activation, 2026-05-20) ===
  //
  // Per CC_SPEC_GPU_RULES_2026-05-19.md + CC_HANDOFF_GPU_WORKSTREAM_
  // 2026-05-19.md. 8 rules consuming Crucible v0.13.0 snap.gpu.
  // validation-pending provenance throughout per Simon's 2026-05-19
  // ship-ahead-of-fleet-validation decision; tightens to fleet-tested
  // in a follow-up PR after 3-5 days of clean data from Simon's 2-3
  // incoming validation hosts. All capability-gated against
  // snap.gpu.available; non-NVIDIA hosts see zero emissions.

  // 33. gpu_xid_critical (P0)
  //
  // Any XID event in snap.gpu.tier1.xid_events with severity=critical
  // in the last 24h window (Crucible's collection window). The agent's
  // (timestamp, bdf, code) dedup is within ONE dmesg read only: the same
  // events re-arrive on every snapshot for as long as they stay in the
  // 24h window, so this rule re-emits each group every snapshot. Ingest's
  // event-stacking dedup (event-stacking.ts, keyed on
  // pci_bdf|xid_code|last_event_iso) is what keeps each re-emission from
  // stacking and re-notifying.
  {
    type: "gpu_xid_critical",
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      const criticals = tier1.xid_events.filter((e) => e.severity === "critical");
      if (criticals.length === 0) return [];
      const results: AlertResult[] = [];
      // One emission per (pci_bdf, xid_code) group; count surfaced as
      // events_in_window.
      const grouped = new Map<string, typeof criticals>();
      for (const e of criticals) {
        const key = `${e.pci_bdf}|${e.xid_code}`;
        const list = grouped.get(key) ?? [];
        list.push(e);
        grouped.set(key, list);
      }
      for (const [key, events] of grouped) {
        const first = events[0];
        const gpu = tier1.gpus.find((g) => g.pci_bdf === first.pci_bdf);
        const xidSummary = xidShortDescription(first.xid_code);
        results.push({
          type: "gpu_xid_critical",
          severity: "critical",
          title: `GPU XID ${first.xid_code} on ${gpu?.name ?? first.pci_bdf} (${xidSummary})`,
          message: `NVIDIA XID ${first.xid_code} (${xidSummary}) reported on ${gpu?.name ?? "GPU"} ${first.pci_bdf}. ${events.length} event${events.length > 1 ? "s" : ""} in window. ${first.xid_code === 79 ? "XID 79 means the GPU fell off the PCIe bus; this is the most severe XID and typically requires GPU replacement or reseat." : "Per NVIDIA's XID error table this is a critical hardware-witnessed fault."}`,
          evidence: {
            gpu_uuid: gpu?.uuid ?? "unknown",
            gpu_name: gpu?.name ?? "unknown",
            pci_bdf: first.pci_bdf,
            xid_code: first.xid_code,
            xid_severity: "critical",
            xid_summary: xidSummary,
            events_in_window: events.length,
            first_event_iso: first.timestamp_iso,
            last_event_iso: events[events.length - 1]?.timestamp_iso ?? first.timestamp_iso,
            raw_message: first.raw_message,
          },
          recommendation: gpuXidRecommendation(first.xid_code),
        });
      }
      return results;
    },
  },

  // 34. gpu_uncorrected_ecc (P0)
  //
  // Triggers on uncorrected ECC aggregate going non-zero, on retired
  // pages double-bit being non-zero, or on retired_pages_pending being
  // non-zero (reboot is pending to actually retire the pages).
  // Capability-gated on ecc_mode_current=true; some inference workloads
  // disable ECC intentionally and the rule should not fire there.
  {
    type: "gpu_uncorrected_ecc",
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      const results: AlertResult[] = [];
      for (const gpu of tier1.gpus) {
        if (!gpu.ecc_mode_current) continue;
        const uncorrected = gpu.ecc_errors_uncorrected_aggregate;
        const volatileUncorrected = gpu.ecc_errors_uncorrected_volatile ?? 0;
        const dbe = gpu.retired_pages_double_bit ?? 0;
        const pending = gpu.retired_pages_pending ?? 0;
        if (uncorrected === 0 && dbe === 0 && pending === 0) continue;

        // Distinguish active VRAM degradation (the RMA signal) from a benign
        // historical single-event upset. A lifetime (aggregate) uncorrected
        // count with NO errors since boot (volatile=0) AND nothing retired or
        // pending is almost always a one-off transient: an SRAM/L2-parity
        // cosmic-ray bit flip, not failing silicon. Nothing was remapped, so
        // the VRAM is intact. Real degradation shows up as errors since boot
        // or as actual/pending page retirements. NVIDIA warrants on row-remap
        // failure / SRAM-threshold-exceeded, not a sub-threshold transient.
        // (round-3 report: box-17 L4, aggregate=1 / volatile=0 / 0 retired
        // pages, was a false RMA.)
        const activeDamage = volatileUncorrected > 0 || dbe > 0 || pending > 0;

        if (!activeDamage) {
          results.push({
            type: "gpu_uncorrected_ecc",
            severity: "info",
            title: `GPU ${gpu.name} (${gpu.pci_bdf}): historical uncorrected ECC (no VRAM damage)`,
            message: `${gpu.name} (${gpu.pci_bdf}) reports ${uncorrected} lifetime uncorrected ECC error(s) but 0 since boot and 0 retired or pending pages. With nothing logged since boot and no page ever remapped, the VRAM is intact: this is almost certainly a one-off transient (e.g. an SRAM-parity bit flip), not degrading memory. Keep the GPU in service.`,
            evidence: {
              gpu_uuid: gpu.uuid,
              gpu_name: gpu.name,
              pci_bdf: gpu.pci_bdf,
              ecc_errors_uncorrected_aggregate: uncorrected,
              ecc_errors_uncorrected_volatile: volatileUncorrected,
              retired_pages_double_bit: dbe,
              retired_pages_pending: pending,
            },
            recommendation: `No action. A lifetime uncorrected count with none since boot and no retired pages does not meet NVIDIA's replacement criteria. Escalate only if uncorrected errors appear since boot, pages begin retiring (or go pending), or an XID 48/94/95 fires on this GPU.`,
          });
          continue;
        }

        results.push({
          type: "gpu_uncorrected_ecc",
          severity: "critical",
          title: `GPU ${gpu.name} (${gpu.pci_bdf}): uncorrected ECC or DBE retired pages`,
          message: `${gpu.name} (${gpu.pci_bdf}) reports ${uncorrected} uncorrected ECC error(s) (${volatileUncorrected} since boot), ${dbe} double-bit-ECC retired pages, ${pending} pending retirement(s). Errors since boot or retired/pending pages indicate active VRAM degradation; in-flight data may have been corrupted. Pending retirements require a reboot to take effect.`,
          evidence: {
            gpu_uuid: gpu.uuid,
            gpu_name: gpu.name,
            pci_bdf: gpu.pci_bdf,
            ecc_errors_uncorrected_aggregate: uncorrected,
            ecc_errors_uncorrected_volatile: volatileUncorrected,
            retired_pages_double_bit: dbe,
            retired_pages_pending: pending,
          },
          recommendation: `Schedule GPU replacement at the next maintenance window. ${pending > 0 ? `Reboot is pending to actually retire ${pending} page(s); the GPU's effective capacity is reduced until the reboot completes.` : ""} Document the GPU UUID + serial for warranty/RMA. Per NVIDIA: uncorrected ECC with errors since boot or page retirement is the canonical VRAM end-of-life signal.`,
        });
      }
      return results;
    },
  },

  // gpu_driver_unsafe_reboot (the nouveau reboot trap; fleet report rec #1)
  //
  // An NVIDIA GPU host is reboot-safe only when the nvidia module is loaded
  // AND nouveau is blacklisted. Otherwise nouveau binds the GPU first on the
  // next boot, the nvidia driver cannot load, nvidia-smi fails, and a
  // marketplace (Vast) host silently de-lists. driver_resilience is collected
  // even when nvidia-smi is dead, so this catches both the already-broken case
  // (nvidia not loaded now) and the latent at-risk case (nouveau not
  // blacklisted) while the box is still up and earning.
  {
    type: "gpu_driver_unsafe_reboot",
    evaluate(snap) {
      const dr = snap.gpu?.driver_resilience;
      if (!dr || !dr.nvidia_pci_present) return [];
      const brokenNow = !dr.nvidia_module_loaded;
      const atRisk = !dr.nouveau_blacklisted;
      if (!brokenNow && !atRisk) return [];
      const cause = brokenNow
        ? "the NVIDIA driver is not loaded, so the GPU is unusable now and a reboot will not recover it"
        : "nouveau is not blacklisted, so the next reboot will let it bind the GPU before the NVIDIA driver and the GPU will not come back";
      return [{
        type: "gpu_driver_unsafe_reboot",
        severity: brokenNow ? "critical" : "warning",
        title: brokenNow
          ? "GPU driver not loaded; will not recover on reboot"
          : "GPU will not survive a reboot (nouveau not blacklisted)",
        message: `This host has an NVIDIA GPU, but ${cause}. ${dr.nouveau_module_loaded ? "nouveau is currently loaded. " : ""}On a marketplace host this silently de-lists the machine after a reboot.`,
        evidence: {
          nvidia_pci_present: dr.nvidia_pci_present,
          nvidia_module_loaded: dr.nvidia_module_loaded,
          nouveau_module_loaded: dr.nouveau_module_loaded,
          nouveau_blacklisted: dr.nouveau_blacklisted,
        },
        recommendation: isRhelFamily(snap)
          ? 'Blacklist nouveau and rebuild the initramfs during a PLANNED maintenance window (not an unplanned reboot): `echo "blacklist nouveau" | sudo tee /etc/modprobe.d/blacklist-nouveau.conf && sudo dracut --force` (this host is RHEL-family; dracut, not update-initramfs). Then reboot in that window and confirm with `nvidia-smi` and `lsmod | grep -e nvidia -e nouveau`.'
          : 'Blacklist nouveau and rebuild the initramfs during a PLANNED maintenance window (not an unplanned reboot): `echo "blacklist nouveau" | sudo tee /etc/modprobe.d/blacklist-nouveau.conf && sudo update-initramfs -u` (Debian/Ubuntu). Then reboot in that window and confirm with `nvidia-smi` and `lsmod | grep -e nvidia -e nouveau`.',
      }];
    },
  },

  // 35. gpu_thermal_critical (P1)
  //
  // Fires on a GENUINE thermal fault only: a hardware thermal slowdown
  // (hw_thermal_slowdown / hw_slowdown - the HW hit its own model-correct
  // slowdown temp) OR die temp >= 92C. It deliberately does NOT fire on
  // sw_thermal_slowdown / thermal_slowdown_active alone: that is the driver
  // holding the card at its thermal *target* under load (normal, not a fault),
  // which caused the round-5 A6000 false alarm at 84C. Sustained-check: 2+
  // consecutive snapshots (the boot-grace pattern is closest available
  // equivalent; not currently implementing sustained per-rule, deferred).
  {
    type: "gpu_thermal_critical",
    boot_grace_seconds: 300,
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      const results: AlertResult[] = [];
      for (const gpu of tier1.gpus) {
        // A genuine thermal fault is a HARDWARE thermal slowdown (the HW hit
        // its own model-correct slowdown temp, e.g. A6000 95C / L4 ~87C) or a
        // high absolute die temp. sw_thermal_slowdown alone is the driver
        // holding the card at its thermal *target* under load (A6000 target
        // 84C, 11C below its 95C slowdown) - normal, not a fault, and it is
        // what caused the round-5 A6000 false alarm (critical at 84C, fan 59%,
        // sw_thermal_slowdown only). thermal_slowdown_active is NOT a standalone
        // trigger either: nvidia-smi sets it for that software target-holding
        // case too. The 92C backstop sits above every data-center GPU's thermal
        // target so normal target-holding never trips it.
        const hwThermalSlowdown =
          gpu.performance_state_reasons.includes("hw_slowdown") ||
          gpu.performance_state_reasons.includes("hw_thermal_slowdown");
        const tooHot = gpu.temp_c >= 92;
        if (!tooHot && !hwThermalSlowdown) continue;
        results.push({
          type: "gpu_thermal_critical",
          severity: "critical",
          title: `GPU ${gpu.name} thermal critical at ${gpu.temp_c}°C`,
          message: `${gpu.name} (${gpu.pci_bdf}) at ${gpu.temp_c}°C${hwThermalSlowdown ? " with a hardware thermal slowdown engaged" : ""}. Data-center GPUs hit their HW slowdown around 87-95°C depending on model (L4 ~87, A100/H100 ~92, A6000 95); sustained operation at or above the HW slowdown threshold accelerates wear and reduces throughput. (A software thermal slowdown at the card's thermal target, e.g. 84°C, is normal load behavior and does not fire this alert.)`,
          evidence: {
            gpu_uuid: gpu.uuid,
            gpu_name: gpu.name,
            pci_bdf: gpu.pci_bdf,
            temp_c: gpu.temp_c,
            thermal_slowdown_active: gpu.thermal_slowdown_active,
            performance_state_reasons: gpu.performance_state_reasons,
            power_draw_w: gpu.power_draw_w,
            power_limit_w: gpu.power_limit_w,
            fan_speed_percent: gpu.fan_speed_percent,
          },
          recommendation: "Inspect chassis airflow first: `ipmitool sensor list | grep -i fan` for fan RPM, check ambient intake temp via BMC, verify the GPU heatsink is seated cleanly (no warpage, no missing pads). On HGX/SXM hosts check the baseboard cooling loop. If airflow is at maximum and temp still climbs, reduce workload thermal load until physical investigation is possible.",
        });
      }
      return results;
    },
  },

  // 36. nvlink_link_down (P1)
  //
  // Multi-GPU hosts only (>=2 GPUs). Fires when any NVLink reports
  // state=down (active fault) on a host where NVLink is expected.
  // Inactive state is NOT fired on by itself - many systems have
  // NVLink legitimately powered down at idle.
  {
    type: "nvlink_link_down",
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      if (tier1.gpus.length < 2) return [];
      const results: AlertResult[] = [];
      for (const gpu of tier1.gpus) {
        const downLinks = gpu.nvlink_links.filter((l) => l.state === "down");
        if (downLinks.length === 0) continue;
        results.push({
          type: "nvlink_link_down",
          severity: "critical",
          title: `NVLink down on ${gpu.name} (${gpu.pci_bdf}): ${downLinks.length} link(s)`,
          message: `${gpu.name} (${gpu.pci_bdf}) reports ${downLinks.length} NVLink(s) in down state (link IDs: ${downLinks.map((l) => l.link_id).join(", ")}). Multi-GPU bandwidth is reduced; if this GPU participates in NCCL collectives the entire training/inference job's latency degrades.`,
          evidence: {
            gpu_uuid: gpu.uuid,
            gpu_name: gpu.name,
            pci_bdf: gpu.pci_bdf,
            down_link_count: downLinks.length,
            down_link_ids: downLinks.map((l) => l.link_id),
            all_links: gpu.nvlink_links,
          },
          recommendation: "Verify NVLink cabling (if NVLink-bridge hardware) or NVSwitch port state (if HGX/SXM). On HGX hosts: `dcgmi nvlink -s -g 0` for richer per-link counters (replay errors, recovery errors). Sustained link-down across reboots suggests cable + connector failure; one-time link-down after a reset can be a transient that recovers.",
        });
      }
      return results;
    },
  },

  // 37. gpu_pcie_link_degraded (P2)
  //
  // Fires when current PCIe gen or width is below max-advertised for
  // any GPU. Common on retrofitted chassis where the GPU is installed
  // in a PCIe slot that is physically x16 but electrically x8.
  {
    type: "gpu_pcie_link_degraded",
    boot_grace_seconds: 180,
    // Idle GPUs drop PCIe link to Gen 1 x8 (or lower) for ASPM power
    // saving; the link renegotiates to its full Gen/width under load.
    // Confirmed on val-L4 / val-RTXA4000 / val-A16: all 3 hosts'
    // freshly-installed GPUs sit at Gen 1 / advertised-max-Gen 4 at
    // 0% utilization. The rule firing in that state is a permanent
    // false positive (cycle-3 design issue #6, 2026-05-21).
    //
    // Gate on utilization: only fire when the GPU is doing meaningful
    // work AND the link is still degraded - that's the true "the GPU
    // could be using more bandwidth than the link allows" signal.
    // 5% utilization is a generous floor (excludes idle / metric-
    // collection blips, includes any real workload).
    //
    // Tradeoff: a GPU that's broken-stuck at Gen 1 even under load
    // still fires; a GPU at idle Gen 1 ASPM doesn't. False positive
    // suppressed; true positive preserved.
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      const results: AlertResult[] = [];
      const UTILIZATION_FLOOR = 5;
      // A GPU genuinely using PCIe bandwidth draws well above its idle floor; an
      // idle / power-capped GPU sits far below its limit. 40% of the cap clears
      // idle (a Vast A16 idles ~15 W of a 62.5 W cap, ~24%) without excluding
      // real workloads.
      const LOADED_POWER_FRACTION = 0.4;
      for (const gpu of tier1.gpus) {
        const genDegraded =
          gpu.pcie_link_gen_max > 0 && gpu.pcie_link_gen_current < gpu.pcie_link_gen_max;
        // Width ceiling: the SLOT's electrical max width (pcie_slot_max_width,
        // from Crucible 0.13.23) when known, else the card's advertised max.
        // An x16 card in a physically x8 slot negotiates x8 == slot max, which
        // is NOT a degradation, just the slot ceiling (val the GPU host L4 in
        // SLOT1 PCIe x8, 2026-07-15). A link trained BELOW the slot's capability
        // (current < slot max) is a real degradation. Older agents send no slot
        // width, so we fall back to the card-max comparison.
        const widthCeiling =
          typeof gpu.pcie_slot_max_width === "number" && gpu.pcie_slot_max_width > 0
            ? gpu.pcie_slot_max_width
            : gpu.pcie_link_width_max;
        const widthDegraded =
          widthCeiling > 0 && gpu.pcie_link_width_current < widthCeiling;
        if (!genDegraded && !widthDegraded) continue;
        // Skip idle GPUs: PCIe link width/gen downshifts for ASPM power saving
        // at idle and re-trains under load, so a degraded link at idle is a
        // false positive. SM utilization alone is unreliable here (a power-
        // capped GPU can blip >5% util while its PCIe link is parked), so also
        // require the GPU to be drawing real power. Confirmed fleet-wide on
        // idle Vast A16s: width x4/x16 at ~15 W against a 62.5 W cap (round 2).
        const idle =
          (gpu.utilization_gpu_percent ?? 0) < UTILIZATION_FLOOR ||
          (gpu.power_limit_w > 0 && gpu.power_draw_w < gpu.power_limit_w * LOADED_POWER_FRACTION);
        if (idle) continue;
        const summary = [
          genDegraded ? `Gen${gpu.pcie_link_gen_current}/${gpu.pcie_link_gen_max}` : null,
          widthDegraded ? `x${gpu.pcie_link_width_current}/x${widthCeiling}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        results.push({
          type: "gpu_pcie_link_degraded",
          severity: "warning",
          title: `GPU ${gpu.name} PCIe degraded (${summary})`,
          message: `${gpu.name} (${gpu.pci_bdf}) negotiated PCIe ${summary}, below what the link can carry (Gen${gpu.pcie_link_gen_max} x${widthCeiling}). Host-to-GPU bandwidth is capped below the slot's capability; for large-model loading or PCIe-attached weights this is meaningful.`,
          evidence: {
            gpu_uuid: gpu.uuid,
            gpu_name: gpu.name,
            pci_bdf: gpu.pci_bdf,
            pcie_link_gen_current: gpu.pcie_link_gen_current,
            pcie_link_gen_max: gpu.pcie_link_gen_max,
            pcie_link_width_current: gpu.pcie_link_width_current,
            pcie_link_width_max: gpu.pcie_link_width_max,
            pcie_slot_max_width: gpu.pcie_slot_max_width ?? null,
            width_ceiling: widthCeiling,
          },
          recommendation: `Inspect: \`sudo lspci -vv -s ${gpu.pci_bdf} | grep -A1 LnkSta\` for LnkSta vs LnkCap. Verify chassis PCIe slot is electrically x16 (some 'x16-mechanical' slots are wired x8). Check BIOS PCIe settings (Gen5/Gen4 may need explicit enable on older platforms). Re-seat the GPU + reseat the riser if applicable; PCIe link renegotiation often recovers on a clean re-seat.`,
        });
      }
      return results;
    },
  },

  // 38. gpu_power_cap_throttling (P2)
  //
  // Fires when sw_power_cap or hw_power_brake throttle reason is
  // engaged. Often intentional (operator-set power cap), so the rule
  // surfaces rather than panics. Sustained-window: per-snapshot for
  // now; sustained gating deferred to follow-up.
  {
    type: "gpu_power_cap_throttling",
    boot_grace_seconds: 300,
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      const results: AlertResult[] = [];
      for (const gpu of tier1.gpus) {
        const swPower = gpu.performance_state_reasons.includes("sw_power_cap");
        const hwBrake = gpu.performance_state_reasons.includes("hw_power_brake");
        if (!swPower && !hwBrake) continue;
        // sw_power_cap alone is the GPU clamping clocks to stay within its power
        // limit: the designed operating point of a power-constrained card (an L4
        // runs at its stock 72W under inference load), not a fault. Emit it as
        // info/expected rather than a recurring warning. hw_power_brake is a
        // hardware over-current / power-delivery protection event and stays a
        // warning. (val the GPU host L4: recurring sw_power_cap at the stock
        // 72W cap under the AI-analysis workload, 2026-07-15.)
        const severity: AlertResult["severity"] = hwBrake ? "warning" : "info";
        results.push({
          type: "gpu_power_cap_throttling",
          severity,
          title: hwBrake
            ? `GPU ${gpu.name} power-cap throttling (HW power brake)`
            : `GPU ${gpu.name} running at its power limit`,
          message: hwBrake
            ? `${gpu.name} (${gpu.pci_bdf}) engaged hw_power_brake (hardware over-current / power-delivery protection)${swPower ? " plus sw_power_cap" : ""}. Power draw ${gpu.power_draw_w}W against limit ${gpu.power_limit_w}W. This is a hardware power event: check PSU sizing, PSU redundancy state, and the chassis power-cap config.`
            : `${gpu.name} (${gpu.pci_bdf}) is clamping clocks to stay within its power limit (sw_power_cap). Power draw ${gpu.power_draw_w}W against limit ${gpu.power_limit_w}W. Expected for a power-constrained card under load (an L4 runs at its stock cap during inference); not a fault. Raise the cap with \`nvidia-smi -pl <watts>\` only if you want higher clocks and the PSU/chassis budget allows.`,
          evidence: {
            gpu_uuid: gpu.uuid,
            gpu_name: gpu.name,
            pci_bdf: gpu.pci_bdf,
            power_draw_w: gpu.power_draw_w,
            power_limit_w: gpu.power_limit_w,
            performance_state_reasons: gpu.performance_state_reasons,
            sw_power_cap_active: swPower,
            hw_power_brake_active: hwBrake,
            power_cap_expected: !hwBrake,
          },
          recommendation: hwBrake
            ? `hw_power_brake means the hardware forced a power reduction. Check \`nvidia-smi -q -d POWER\`, PSU sizing and redundancy state, and the chassis power budget.`
            : `Informational: the GPU is running at its power limit, expected under load for a power-capped card. Acknowledge if the cap is intentional. Check the limit with \`nvidia-smi -q -d POWER\`; raise via \`sudo nvidia-smi -pl <watts>\` only if higher clocks are wanted and the PSU budget allows.`,
        });
      }
      return results;
    },
  },

  // 39. gpu_driver_or_firmware_drift (P3)
  //
  // Cross-host fleet inconsistency. Per-snapshot this rule can't
  // detect drift across multiple hosts; for v1 we emit only when
  // ALL of the host's GPUs disagree on vbios_version (within-host
  // mismatch, which is itself a real failure mode - bad firmware
  // update). Cross-host fleet drift detection requires per-customer
  // aggregation that doesn't exist in the per-snapshot evaluator
  // and is a follow-up.
  {
    type: "gpu_driver_or_firmware_drift",
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      if (tier1.gpus.length < 2) return [];
      // Within-host: group GPUs by (name, vbios_version); if a single
      // GPU model has multiple vbios versions, that's drift.
      const byModel = new Map<string, Set<string>>();
      for (const gpu of tier1.gpus) {
        const set = byModel.get(gpu.name) ?? new Set();
        set.add(gpu.vbios_version);
        byModel.set(gpu.name, set);
      }
      const driftedModels: Array<{ name: string; versions: string[] }> = [];
      for (const [name, versions] of byModel) {
        if (versions.size > 1) {
          driftedModels.push({ name, versions: Array.from(versions) });
        }
      }
      if (driftedModels.length === 0) return [];
      return [{
        type: "gpu_driver_or_firmware_drift",
        severity: "info",
        title: `GPU vbios drift on host: ${driftedModels.map((d) => d.name).join(", ")}`,
        message: `Multiple GPUs of the same model on this host report different vbios versions. Within-host vbios drift typically means a failed firmware update on one of the GPUs, or a mixed-batch installation. ${driftedModels.map((d) => `${d.name}: ${d.versions.join(" vs ")}`).join("; ")}`,
        evidence: {
          driver_version: tier1.driver_version,
          drifted_models: driftedModels,
        },
        recommendation: `Verify with \`nvidia-smi --query-gpu=index,name,vbios_version --format=csv\`. Re-flash the outlier GPU's vbios to the fleet baseline using vendor tooling. Cross-host fleet drift detection (fleet-wide driver_version inconsistency) is deferred to a follow-up rule once cross-snapshot aggregation primitives ship.`,
      }];
    },
  },

  // 40. gpu_corrected_ecc_storm (P3)
  //
  // Fires on absolute correctable ECC rate >100 errors/hour OR
  // single-bit retired pages > 0. Tier 2 weighting on retired_pages_
  // detail growth is deferred (Tier 2 ships as stub in v0.13.0).
  //
  // Rate calculation requires cross-snapshot history; for v1 we
  // approximate by using the aggregate counter and noting in evidence
  // that this is a "level" signal rather than a true rate. If the
  // aggregate counter is large and growing, the operator should
  // investigate; cross-snapshot rate calc is a follow-up.
  {
    type: "gpu_corrected_ecc_storm",
    evaluate(snap) {
      const tier1 = snap.gpu?.available ? snap.gpu.tier1 : undefined;
      if (!tier1 || !("available" in tier1) || !tier1.available) return [];
      const results: AlertResult[] = [];
      for (const gpu of tier1.gpus) {
        if (!gpu.ecc_mode_current) continue;
        const sbeRetired = gpu.retired_pages_single_bit ?? 0;
        // Volatile counter resets at GPU power cycle; aggregate is
        // since-manufacture-or-last-clear. Volatile > 1000 in a
        // single snapshot is the absolute-threshold trigger.
        const volatileHigh = gpu.ecc_errors_corrected_volatile > 1000;
        if (sbeRetired === 0 && !volatileHigh) continue;
        results.push({
          type: "gpu_corrected_ecc_storm",
          severity: "info",
          title: `GPU ${gpu.name} corrected-ECC level high (${gpu.ecc_errors_corrected_volatile} volatile)`,
          message: `${gpu.name} (${gpu.pci_bdf}) reports ${gpu.ecc_errors_corrected_volatile} corrected ECC errors (volatile since GPU power-on), ${gpu.ecc_errors_corrected_aggregate} aggregate, ${sbeRetired} single-bit retired pages. SBE storms typically precede DBE faults; schedule a preventive replacement if rate climbs further.`,
          evidence: {
            gpu_uuid: gpu.uuid,
            gpu_name: gpu.name,
            pci_bdf: gpu.pci_bdf,
            ecc_errors_corrected_volatile: gpu.ecc_errors_corrected_volatile,
            ecc_errors_corrected_aggregate: gpu.ecc_errors_corrected_aggregate,
            retired_pages_single_bit: sbeRetired,
            note: "Per-snapshot absolute thresholds; cross-snapshot rate calc deferred to follow-up.",
          },
          recommendation: `On A100/L4: monitor retired_pages_single_bit growth; once it climbs above the GPU's published threshold (typically 64 pages per memory channel), VRAM capacity loss becomes measurable. On H100+: NVIDIA replaced retired-pages with row-remapping; check \`nvidia-smi --query-remapped-rows=remapped_rows.failure,remapped_rows.correctable,remapped_rows.uncorrectable\` for that path.`,
        });
      }
      return results;
    },
  },
];

// Separate evaluator for unexpected_reboot that needs previous snapshot data.
// snapshotTsMs: the exact millisecond timestamp used when inserting this snapshot.
export function evaluateUnexpectedReboot(
  snap: Snapshot,
  prevUptimeSeconds: number | null,
  prevTimestamp: number | null,
  hasActiveRebootAlert: boolean,
  snapshotTsMs: number,
  suppressions?: SuppressedAlert[],
): AlertResult | null {
  if (prevUptimeSeconds == null || prevTimestamp == null) return null;
  if (hasActiveRebootAlert) return null; // Only fire once per reboot event
  if (snap.system.uptime_seconds >= 600) return null; // Uptime > 10 min, not a recent reboot

  const elapsedSec = (snapshotTsMs - prevTimestamp) / 1000;
  const expectedUptime = prevUptimeSeconds + elapsedSec;

  if (snap.system.uptime_seconds < expectedUptime * 0.5) {
    // Operator signalled a planned reboot via `crucible-agent
    // mark-reboot` / `reboot`; don't page them for it. Still audit so
    // "was this suppression intentional" is answerable later.
    if (snap.expected_reboot === true) {
      if (suppressions) {
        const rebootTimeIso = new Date(snapshotTsMs - snap.system.uptime_seconds * 1000).toISOString();
        suppressions.push({
          type: "unexpected_reboot",
          reason: "planned_reboot",
          uptime_at_evaluation: snap.system.uptime_seconds,
          planned_reboot_reason: snap.expected_reboot_reason,
          title: "Planned reboot (suppressed)",
          message: `Planned reboot acknowledged via Crucible. Reason: ${snap.expected_reboot_reason ?? "not provided"}.`,
          severity: "critical",
          evidence: {
            current_uptime_seconds: snap.system.uptime_seconds,
            previous_uptime_seconds: prevUptimeSeconds,
            estimated_reboot_time: rebootTimeIso,
            expected_reboot_reason: snap.expected_reboot_reason ?? null,
          },
        });
      }
      return null;
    }
    const rebootTime = new Date(snapshotTsMs - snap.system.uptime_seconds * 1000).toISOString();
    const uptimeMin = Math.floor(snap.system.uptime_seconds / 60);
    const prevUptimeHrs = Math.floor(prevUptimeSeconds / 3600);

    // Enrichment from Crucible v0.10.4+ snap.reboot_evidence (C4).
    // Capability-gated: hosts on older agents see no enrichment and
    // fall back to warning (uptime-only detection is lower-signal
    // than kernel-corroborated detection). Per CC_SPEC_FORGE_C1_C6_
    // DEFERRED_TUNES §3.2.
    const re = snap.reboot_evidence;
    const detectionSignals = {
      via_uptime: true,
      via_pstore: re?.pstore_present === true,
      via_vmcore: re?.vmcore_present === true,
      via_wtmp_unclean: re?.prior_shutdown_clean === false,
      reboot_evidence_available: re !== undefined,
    };
    // Severity by confidence that the reboot was UNCLEAN. Only hard kernel
    // evidence (a captured panic in pstore, or a vmcore crash dump) justifies
    // a critical page. A missing clean-shutdown record in the wtmp accounting
    // log is a softer userspace hint (possible power loss), not proof, and is
    // prone to false positives where `last` does not surface the shutdown
    // record: it warrants a warning. A recorded clean shutdown with no crash
    // evidence is an intentional reboot: it belongs in history, not as an
    // active alert.
    const kernelCrashEvidence = detectionSignals.via_pstore || detectionSignals.via_vmcore;
    // A clean, intentional reboot: we HAVE reboot evidence and it shows a clean
    // shutdown. Without any reboot_evidence (pre-0.10.4 agent) we cannot claim
    // it was clean, so that case stays a warning.
    const cleanIntentional = isCleanIntentionalReboot(
      snap,
      prevUptimeSeconds,
      prevTimestamp,
      snapshotTsMs,
    );
    if (cleanIntentional) return null;
    const severity: AlertResult["severity"] = kernelCrashEvidence ? "critical" : "warning";

    const corroborationNote = kernelCrashEvidence
      ? ` The kernel captured crash evidence (${[
          detectionSignals.via_pstore ? "pstore panic" : "",
          detectionSignals.via_vmcore ? "vmcore dump" : "",
        ].filter(Boolean).join(" + ")}); this was not a clean shutdown.`
      : " No clean-shutdown record was found before the boot (possible power loss or hard reset), and the kernel captured no crash dump. If you rebooted this host on purpose, this is expected.";

    const title = kernelCrashEvidence
      ? "Server rebooted after a kernel crash"
      : "Server rebooted unexpectedly";

    return {
      type: "unexpected_reboot",
      severity,
      title,
      message: `Server rebooted. Current uptime: ${uptimeMin} minutes. Previous uptime was ${prevUptimeHrs} hours.${corroborationNote}`,
      evidence: {
        current_uptime_seconds: snap.system.uptime_seconds,
        previous_uptime_seconds: prevUptimeSeconds,
        estimated_reboot_time: rebootTime,
        detection_signals: detectionSignals,
        ...(re !== undefined
          ? {
              reboot_evidence: {
                pstore_present: re.pstore_present,
                pstore_record_count: re.pstore_record_count,
                vmcore_present: re.vmcore_present,
                prior_shutdown_clean: re.prior_shutdown_clean,
                wtmp_reboot_record: re.wtmp_reboot_record,
              },
            }
          : {}),
      },
      recommendation: kernelCrashEvidence
        ? "Kernel crash evidence is present. If pstore: read the captured panic via `dmesg --pstore` or `cat /sys/fs/pstore/dmesg-*`. If vmcore: analyse `/var/crash/*` with the `crash` utility against the matching debug kernel."
        : "Server rebooted without a kernel crash dump and without a clean-shutdown record. If this was not intentional, check IPMI SEL for power events and the previous boot's journal: `journalctl -b -1 --no-pager | tail -100`. Common causes: power outage, watchdog timer, manual power cycle.",
    };
  }
  return null;
}

/**
 * A fresh, low-uptime snapshot that follows a clean shutdown and contains no
 * kernel crash evidence is an intentional reboot. The ingest path uses this
 * to close an older false-positive reboot row without waiting for event decay.
 */
export function isCleanIntentionalReboot(
  snap: Snapshot,
  prevUptimeSeconds: number | null,
  prevTimestamp: number | null,
  snapshotTsMs: number,
): boolean {
  if (prevUptimeSeconds == null || prevTimestamp == null) return false;
  if (snap.system.uptime_seconds >= 600) return false;

  const elapsedSec = (snapshotTsMs - prevTimestamp) / 1000;
  const expectedUptime = prevUptimeSeconds + elapsedSec;
  if (snap.system.uptime_seconds >= expectedUptime * 0.5) return false;

  return hasCleanRebootEvidence(snap.reboot_evidence);
}

/** True when a snapshot or stored alert evidence proves a clean reboot. */
export function hasCleanRebootEvidence(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const root = value as Record<string, unknown>;
  const evidence = (
    typeof root.reboot_evidence === "object" && root.reboot_evidence !== null
      ? root.reboot_evidence
      : root
  ) as Record<string, unknown>;
  return evidence.prior_shutdown_clean === true &&
    evidence.pstore_present !== true &&
    evidence.vmcore_present !== true;
}

// Default decay window for unexpected_reboot alerts. After this many hours
// of stable uptime since the alert fired, the alert auto-resolves on the
// next ingest cycle. Per-server override via `unexpected_reboot_decay_hours`
// in the `config_overrides` JSONB column on `servers`.
export const UNEXPECTED_REBOOT_DECAY_HOURS_DEFAULT = 24;

export interface UnexpectedRebootDecayDecision {
  shouldResolve: boolean;
  decay_hours_used: number;
  resolution_reason?: string;
}

// Pure decision function: given current uptime and any per-server override,
// should the existing active unexpected_reboot alert auto-resolve?
//
// The reboot alert is single-fire (the evaluator short-circuits on
// `hasActiveRebootAlert`) which is correct at the moment the alert is
// useful but turns into noise once the box has been stable for a day.
// This decay lets stale alerts age out automatically rather than
// requiring operator ack-and-resolve on every box after every cleanup
// reboot.
//
// Caller is responsible for the database UPDATE; this function only
// reads inputs and returns a decision so it stays unit-testable without
// the Postgres pool.
export function evaluateUnexpectedRebootDecay(
  uptimeSeconds: number,
  configOverrides: { unexpected_reboot_decay_hours?: unknown } | null | undefined,
): UnexpectedRebootDecayDecision {
  const rawOverride = configOverrides?.unexpected_reboot_decay_hours;
  const overrideHours =
    typeof rawOverride === "number" && Number.isFinite(rawOverride) && rawOverride > 0
      ? rawOverride
      : null;
  const decayHours = overrideHours ?? UNEXPECTED_REBOOT_DECAY_HOURS_DEFAULT;
  const decaySeconds = decayHours * 3600;
  if (uptimeSeconds >= decaySeconds) {
    return {
      shouldResolve: true,
      decay_hours_used: decayHours,
      resolution_reason: `auto_decay_stable_${decayHours}h`,
    };
  }
  return { shouldResolve: false, decay_hours_used: decayHours };
}

// ---------------------------------------------------------------------------
// Interface error evaluator (three-tier, per-slave, sustained-2-intervals)
// ---------------------------------------------------------------------------

export type InterfaceErrorTier = "none" | "yellow" | "orange" | "red";

export interface InterfaceErrorClassification {
  interface: string;
  display_name: string; // e.g. "enp1s0f0 (slave of bond0)"
  tier: InterfaceErrorTier;
  /** Which signal drove the tier decision. "errors" when the hardware-error
   *  branch triggered; "drops" when the drop-ratio branch did; "none" when
   *  the interface is clean or suppressed. */
  driver: "errors" | "drops" | "none";
  errors: number;
  packets: number;
  ratio: number | null;
  drops: number;
  drop_ratio: number | null;
  sustained: boolean;
  evidence: Record<string, number>;
}

// rx_errors/tx_errors are the kernel's AGGREGATE counters; most drivers
// already fold the crc/frame/length (and carrier) subtypes into them, so
// summing aggregate + subtypes double-counts. Observed 2026-07-01
// (datapacketvastlistings-17): rx_errors=2 plus rx_length_errors=2 was
// reported as "4 hardware errors" for 2 bad frames. Take the max of the
// aggregate and its subtype sum per direction: correct when the driver
// folds subtypes in, and still correct for drivers that leave the
// aggregate at 0 and only tick the subtypes.
const HW_ERROR_SUM = (iface: any): number => {
  const rxSub =
    (iface.rx_crc_errors || 0) +
    (iface.rx_frame_errors || 0) +
    (iface.rx_length_errors || 0);
  const rx = Math.max(iface.rx_errors || 0, rxSub);
  const tx = Math.max(iface.tx_errors || 0, iface.tx_carrier_errors || 0);
  return rx + tx;
};

const MIN_PACKETS_FOR_RATIO = 1_000;
const ORANGE_RATIO = 0.0001;   // 0.01%
const ORANGE_MIN_PACKETS = 10_000;
const ORANGE_ABS = 10;
const RED_RATIO = 0.001;       // 0.1%
const RED_ABS = 100;
const DROP_RED = 0.10;
const DROP_ORANGE = 0.01;
const DROP_YELLOW = 0.001;

function classifyInterfaceErrors(
  iface: any,
  prev: any | undefined,
  firewallActive: boolean
): InterfaceErrorClassification {
  const rxErr = iface.rx_errors || 0;
  const txErr = iface.tx_errors || 0;
  const rxDrops = iface.rx_drops || 0;
  const txDrops = iface.tx_drops || 0;
  const errors = HW_ERROR_SUM(iface);
  const drops = rxDrops + txDrops;
  const packets = (iface.rx_packets || 0) + (iface.tx_packets || 0);
  const ratio = packets >= MIN_PACKETS_FOR_RATIO ? errors / packets : null;
  const dropRatio = packets >= MIN_PACKETS_FOR_RATIO ? drops / packets : null;

  const isBondMaster = iface.is_bond_master === true ||
    (iface.interface?.startsWith("bond") && iface.bond_master == null);
  const ifName = iface.interface;
  const display_name = iface.bond_master ? `${ifName} (slave of ${iface.bond_master})` : ifName;

  // Previous-interval error count for the same interface (used only for
  // the "sustained across 2 consecutive intervals" gate).
  const prevErrors = prev ? HW_ERROR_SUM(prev) : 0;

  // Compute the error-driven tier and the drop-driven tier independently,
  // then keep whichever is higher. Previously the drop branch only ran
  // when the error branch produced `none`, so a single CRC tick combined
  // with a 2% drop rate surfaced as yellow-errors and hid the orange/red
  // drop signal entirely (Codex review 2026-04-22).
  // Ratio-driven tiers need more than the bare ratio: at moderate packet
  // volumes a ratio crosses the threshold on a statistically meaningless
  // handful of errors. Observed 2026-07-01 (datapacketvastlistings-17):
  // 4 errors / 22,533 packets = 0.018% paged orange from a single clean
  // interval, then auto-resolved 5 min later. Worse latent case: at the
  // 1,000-packet ratio floor, 0.1% is ONE error, which paged red. So:
  //   red-ratio    also requires >= ORANGE_MIN_PACKETS packets and
  //                >= ORANGE_ABS errors (0.1% of 10k packets = 10 errors,
  //                consistent with the absolute branch).
  //   orange-ratio also requires errors in the PREVIOUS interval, the
  //                same sustained idea the absolute branch always had. A
  //                real physical-layer fault errors continuously; a
  //                single-interval blip stays yellow (dashboard-only).
  let errorTier: InterfaceErrorTier = "none";
  if (
    (ratio !== null && ratio >= RED_RATIO && packets >= ORANGE_MIN_PACKETS && errors >= ORANGE_ABS) ||
    errors >= RED_ABS
  ) {
    errorTier = "red";
  } else if (
    (ratio !== null && ratio >= ORANGE_RATIO && packets >= ORANGE_MIN_PACKETS && prevErrors > 0) ||
    (errors >= ORANGE_ABS && prevErrors >= ORANGE_ABS)
  ) {
    errorTier = "orange";
  } else if (errors > 0) {
    errorTier = "yellow";
  }

  // Drop-only evaluation: suppressed entirely on bond masters (spec) and
  // on any interface when the host firewall is active (firewalls generate
  // routine drops that swamp the denominator).
  let dropTier: InterfaceErrorTier = "none";
  if (drops > 0 && !isBondMaster && !firewallActive && dropRatio !== null) {
    if (dropRatio >= DROP_RED) dropTier = "red";
    else if (dropRatio >= DROP_ORANGE) dropTier = "orange";
    else if (dropRatio >= DROP_YELLOW) dropTier = "yellow";
  }

  const rank = (t: InterfaceErrorTier) =>
    t === "red" ? 3 : t === "orange" ? 2 : t === "yellow" ? 1 : 0;

  let tier: InterfaceErrorTier;
  let driver: "errors" | "drops" | "none";
  if (rank(dropTier) > rank(errorTier)) {
    tier = dropTier;
    driver = "drops";
  } else if (errorTier !== "none") {
    tier = errorTier;
    driver = "errors";
  } else if (dropTier !== "none") {
    tier = dropTier;
    driver = "drops";
  } else {
    tier = "none";
    driver = "none";
  }

  return {
    interface: ifName,
    display_name,
    tier,
    driver,
    errors,
    packets,
    ratio,
    drops,
    drop_ratio: dropRatio,
    sustained: prevErrors >= ORANGE_ABS,
    evidence: {
      rx_errors: rxErr, tx_errors: txErr,
      rx_crc_errors: iface.rx_crc_errors || 0,
      rx_frame_errors: iface.rx_frame_errors || 0,
      rx_length_errors: iface.rx_length_errors || 0,
      tx_carrier_errors: iface.tx_carrier_errors || 0,
      rx_drops: rxDrops, tx_drops: txDrops,
      rx_packets: iface.rx_packets || 0, tx_packets: iface.tx_packets || 0,
      prev_errors: prevErrors,
    },
  };
}

/**
 * Three-tier interface error evaluator. Needs the previous snapshot's
 * network array for the sustained-2-intervals check at the orange
 * absolute-count threshold.
 *
 * Per-slave evaluation: bond masters are skipped entirely; slaves carry
 * their bond identity into `display_name`.
 * Returns the alerts to fire (orange/red only; yellow is dashboard-only).
 * Also returns the per-interface classifications for dashboard color-coding.
 */
/**
 * Look up the declared `boot_grace_seconds` for a rule type. Out-of-band
 * evaluators (e.g. `interface_errors`, which needs the previous snapshot
 * and runs from the ingest path, not the main `evaluateAlerts` loop) use
 * this so the canonical grace lives in one place: changing the rule
 * table updates the ingest-path suppression automatically.
 * Returns 0 for unknown rules or rules without a declared grace.
 */
export function getRuleBootGrace(type: string): number {
  const rule = rules.find((r) => r.type === type);
  return rule?.boot_grace_seconds ?? 0;
}

export function evaluateInterfaceErrors(
  snap: Snapshot,
  prevNetwork: any[] | null,
): { alerts: AlertResult[]; classifications: InterfaceErrorClassification[] } {
  const out: AlertResult[] = [];
  const classifications: InterfaceErrorClassification[] = [];
  if (!snap.network) return { alerts: out, classifications };

  const firewallActive = snap.security?.firewall?.active ?? false;
  const prevByIface = new Map<string, any>();
  for (const p of prevNetwork ?? []) prevByIface.set(p.interface, p);

  for (const iface of snap.network) {
    const ifName = iface.interface;
    // Skip bond masters; evaluate per-slave.
    const isBondMaster = iface.is_bond_master === true ||
      (ifName?.startsWith("bond") && iface.bond_master == null);
    if (isBondMaster) {
      classifications.push({
        interface: ifName, display_name: ifName, tier: "none", driver: "none",
        errors: 0, packets: 0, ratio: null, drops: 0, drop_ratio: null,
        sustained: false, evidence: {},
      });
      continue;
    }

    const cls = classifyInterfaceErrors(iface, prevByIface.get(ifName), firewallActive);
    classifications.push(cls);
    if (cls.tier === "none" || cls.tier === "yellow") continue;

    const fixCmds = buildIfaceFixCmds(ifName, !!iface.bond_master, snap.network);
    const packetsStr = cls.packets.toLocaleString();

    if (cls.driver === "drops") {
      // Drop-ratio driven tier. Message talks about drops. HW errors may
      // be non-zero here (we picked the drop tier because it out-ranked
      // the error tier); the dashboard still surfaces the error count in
      // evidence.
      const ratioStr = cls.drop_ratio !== null ? `${(cls.drop_ratio * 100).toFixed(2)}%` : "ratio N/A";
      out.push({
        type: "interface_errors",
        severity: cls.tier === "red" ? "critical" : "warning",
        title: `${cls.display_name}: ${cls.drops} packet drops`,
        message: `${cls.display_name}: ${cls.tier === "red" ? "critical" : "elevated"} packet drop rate. ${cls.drops} drops over 5 min (${ratioStr} of ${packetsStr} packets).`,
        evidence: { interface: ifName, tier: cls.tier, driver: "drops", ...cls.evidence, fix_commands: fixCmds },
        recommendation: `Packet drops on ${ifName}. Likely causes: kernel ring buffer too small (\`ethtool -g ${ifName}\`), CPU softirq pressure, or driver queue exhaustion. Drops with hardware errors clean usually indicate a software-side bottleneck, not a physical layer fault.`,
      });
      continue;
    }

    const pctStr = cls.ratio !== null ? `${(cls.ratio * 100).toFixed(3)}%` : "ratio N/A";
    if (cls.tier === "red") {
      out.push({
        type: "interface_errors",
        severity: "critical",
        title: `${cls.display_name}: ${cls.errors} hardware errors`,
        message: `${cls.display_name}: critical hardware error rate. ${cls.errors} errors over 5 min (${pctStr} of ${packetsStr} packets).`,
        evidence: { interface: ifName, tier: cls.tier, driver: "errors", ...cls.evidence, fix_commands: fixCmds },
        recommendation: `Active physical layer fault. Check cable, SFP/transceiver (\`ethtool -m ${ifName}\`), NIC status (\`ethtool ${ifName}\`), and kernel log (\`dmesg | grep -i '${ifName}\\|link'\`).`,
      });
    } else {
      out.push({
        type: "interface_errors",
        severity: "warning",
        title: `${cls.display_name}: ${cls.errors} hardware errors`,
        message: `${cls.display_name}: elevated hardware errors. ${cls.errors} errors over 5 min (${pctStr} of ${packetsStr} packets).${cls.sustained ? " Sustained across 2 consecutive intervals." : ""}`,
        evidence: { interface: ifName, tier: cls.tier, driver: "errors", ...cls.evidence, fix_commands: fixCmds },
        recommendation: `Check cable, SFP/transceiver, and NIC status: \`ethtool ${ifName}\`, \`ethtool -S ${ifName} | egrep -i "err|drop|crc|miss|fault|timeout|reset"\`.`,
      });
    }
  }

  return { alerts: out, classifications };
}

export function evaluateAlerts(
  snapshot: Snapshot,
  config: ServerConfig = {},
  suppressions?: SuppressedAlert[],
  /**
   * Optional per-rule cross-snapshot payload map. Built by the ingest
   * path's pre-pass; keyed by rule type. Rules without a YAML
   * cross_snapshot block ignore this parameter.
   * See CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §2.2.
   */
  crossSnapshotData?: Map<string, CrossSnapshotPayload>,
): AlertResult[] {
  const muted = new Set(config.muted_rules || []);
  const uptime = snapshot.system?.uptime_seconds ?? Infinity;
  const results: AlertResult[] = [];

  // Codex 2026-05-22B F5: classifier rules whose YAML declares
  // `cross_snapshot.correlate_with` must run AFTER their subordinates so
  // they see same-snapshot first-pass emissions, not just the previous-
  // snapshot active alerts loaded into ctx.cross_snapshot.correlation by
  // the Postgres pre-pass. Without this two-phase split, a same-snapshot
  // co-fire of (e.g.) conntrack_exhaustion + listen_overflow would miss
  // accept_backlog_or_syn_flood until the next ingest cycle.
  const classifierCorrelateWith = new Map<string, Set<string>>();
  for (const rule of rules) {
    const meta = getRuleMetadata(rule.type);
    const ids = meta?.cross_snapshot?.correlate_with?.rule_ids;
    if (ids && ids.length > 0) {
      classifierCorrelateWith.set(rule.type, new Set(ids));
    }
  }
  const phase1 = rules.filter((r) => !classifierCorrelateWith.has(r.type));
  const phase2 = rules.filter((r) => classifierCorrelateWith.has(r.type));

  function runRule(rule: AlertRule, ctx: EvaluatorContext | undefined): void {
    if (muted.has(rule.type)) return;
    try {
      const alerts = rule.evaluate(snapshot, config, ctx);
      if (alerts.length === 0) return;
      // Boot-grace gate. Strict `<` so a grace of 60 lets a rule fire at
      // exactly 60 s of uptime (matches the spec's boundary test).
      const grace = rule.boot_grace_seconds ?? 0;
      if (grace > 0 && uptime < grace) {
        if (suppressions) {
          for (const a of alerts) {
            suppressions.push({
              type: a.type,
              reason: "boot_grace",
              uptime_at_evaluation: uptime,
              grace_seconds: grace,
              title: a.title,
              message: a.message,
              severity: a.severity,
              evidence: a.evidence,
            });
          }
        }
        return;
      }
      results.push(...alerts);
    } catch (err) {
      // Individual rule failures should not crash evaluation
      console.error(`Alert rule ${rule.type} error:`, err);
    }
  }

  // Phase 1: non-classifier rules.
  for (const rule of phase1) {
    const ctx: EvaluatorContext | undefined = crossSnapshotData?.has(rule.type)
      ? { cross_snapshot: crossSnapshotData.get(rule.type)! }
      : undefined;
    runRule(rule, ctx);
  }

  // Phase 2: classifier rules. Augment ctx.cross_snapshot.correlation
  // with same-snapshot phase-1 emissions that intersect this classifier's
  // declared correlate_with rule_ids. The dedup behavior + earliest-
  // first_seen semantics mirror what correlatedRulesActive() returns from
  // Postgres: callers see one boolean "is X in matched?" without caring
  // whether the signal came from a prior ingest or this one.
  const phase1FiredTypes = new Set(results.map((r) => r.type));
  for (const rule of phase2) {
    const correlate = classifierCorrelateWith.get(rule.type)!;
    const sameSnapshotMatches: string[] = [];
    for (const fired of phase1FiredTypes) {
      if (correlate.has(fired)) sameSnapshotMatches.push(fired);
    }

    let ctx: EvaluatorContext | undefined;
    const preFromPg = crossSnapshotData?.get(rule.type);
    if (preFromPg || sameSnapshotMatches.length > 0) {
      const pgMatched = preFromPg?.correlation?.matched ?? [];
      const mergedMatched = Array.from(
        new Set([...pgMatched, ...sameSnapshotMatches]),
      );
      const pgOldest = preFromPg?.correlation?.oldest_first_seen_ms ?? null;
      // Same-snapshot rules don't have a first_seen in active_alerts yet;
      // use "now" so callers can still anchor incident-start clocks.
      const sameSnapshotOldest =
        sameSnapshotMatches.length > 0 ? Date.now() : null;
      const oldest =
        pgOldest !== null && sameSnapshotOldest !== null
          ? Math.min(pgOldest, sameSnapshotOldest)
          : (pgOldest ?? sameSnapshotOldest);

      ctx = {
        cross_snapshot: {
          snapshots: preFromPg?.snapshots ?? [],
          correlation:
            mergedMatched.length > 0
              ? { matched: mergedMatched, oldest_first_seen_ms: oldest }
              : (preFromPg?.correlation ?? null),
        },
      };
    }
    runRule(rule, ctx);
  }

  return results;
}

// ============================================================================
// Cross-snapshot rule: rate-based correctable ECC (glassmkr#24).
// ============================================================================
//
// BMC ECC counters (both named-sensor and SEL-derived) are
// cumulative-since-last-clear. A static threshold misbehaves on
// long-running hosts: a healthy server that's been up for two years
// will show a non-zero correctable count from background cosmic-ray
// noise across that entire lifetime. The rate of new errors is the
// real signal.
//
// Evaluation policy:
//   - Uncorrectable: handled by the synchronous rule above. Any
//     non-zero count fires critical immediately, regardless of rate.
//   - Correctable: rate-based with a default of >10 errors per 24h.
//     Per-server overrides via `ecc_correctable_rate_warning`
//     (threshold) and `ecc_rate_window_hours` (window length).
//
// Cross-snapshot lookup pattern: identical shape to
// evaluateInterfaceErrors above. See clickhouse-state.ts for the
// helper. The helper handles ClickHouse failure (returns null), no
// historical snapshot in window (returns null), and counter resets
// (returns counterReset: true with deltas zeroed).
//
// Boot grace: this rule is in the central rule table with a
// boot_grace_seconds value so the same uptime gate applies as for
// other hardware rules. The boot-grace decision lives at the call
// site in ingest/+server.ts (same pattern as interface_errors).

import { getEccDeltaInWindow } from "./clickhouse-state.js";

export const ECC_RATE_THRESHOLD_DEFAULT = 10;
export const ECC_RATE_WINDOW_HOURS_DEFAULT = 24;

export async function evaluateEccErrors(
  snap: Snapshot,
  config: ServerConfig,
  serverId: string,
): Promise<AlertResult[]> {
  if (!snap.ipmi?.ecc_errors) return [];
  const namedCorr = sanitizeCount(snap.ipmi.ecc_errors.correctable);
  const selCorr = sanitizeCount(snap.ipmi.ecc_errors_from_sel?.correctable);
  const namedUnc = sanitizeCount(snap.ipmi.ecc_errors.uncorrectable);
  const selUnc = sanitizeCount(snap.ipmi.ecc_errors_from_sel?.uncorrectable);
  const currentCorr = Math.max(namedCorr, selCorr);
  const currentUnc = Math.max(namedUnc, selUnc);

  // Uncorrectable is handled by the synchronous rule (immediate
  // critical, no rate gate). Don't double-fire here.
  if (currentCorr <= 0) return [];

  const windowHours =
    typeof config.ecc_rate_window_hours === "number" && config.ecc_rate_window_hours > 0
      ? Math.floor(config.ecc_rate_window_hours)
      : ECC_RATE_WINDOW_HOURS_DEFAULT;

  // Threshold resolution: prefer new field, fall back to legacy
  // override field for backward compat with anything migration 014
  // hasn't touched, then the default. Spec section 4.
  const threshold =
    typeof config.ecc_correctable_rate_warning === "number" && config.ecc_correctable_rate_warning >= 1
      ? Math.floor(config.ecc_correctable_rate_warning)
      : typeof config.ecc_correctable_warning === "number" && config.ecc_correctable_warning >= 1
        ? Math.floor(config.ecc_correctable_warning)
        : ECC_RATE_THRESHOLD_DEFAULT;

  const delta = await getEccDeltaInWindow(serverId, windowHours, currentCorr, currentUnc);
  if (delta === null) {
    // Insufficient data (new server, ingest gap, or transient
    // ClickHouse failure). Skip this cycle; the next snapshot will
    // either have enough history or surface a real persistent
    // outage via the server_unreachable rule.
    return [];
  }
  if (delta.counterReset) {
    console.log(
      `[ecc_errors] counter reset detected server=${serverId} ` +
      `current_correctable=${currentCorr} (BMC clear / reboot suspected); ` +
      `skipping this cycle`,
    );
    return [];
  }
  if (delta.correctable < threshold) return [];

  const path = derivePath(namedCorr + namedUnc, selCorr + selUnc);
  const evidence = {
    delta_correctable: delta.correctable,
    window_hours: windowHours,
    threshold,
    current_correctable: currentCorr,
    named: { correctable: namedCorr, uncorrectable: namedUnc },
    sel: {
      correctable: selCorr,
      uncorrectable: selUnc,
      newest_event_timestamp: snap.ipmi.ecc_errors_from_sel?.newest_event_timestamp ?? null,
    },
    path,
    evaluation: "rate_based" as const,
  };

  return [{
    type: "ecc_errors",
    severity: "warning",
    title: `${delta.correctable} correctable ECC error(s) in last ${windowHours}h`,
    message:
      `${delta.correctable} new correctable ECC errors observed on this host in the last ` +
      `${windowHours}h (threshold: ${threshold}). Correctable ECC errors are the strongest ` +
      `early warning of impending DIMM failure.`,
    evidence,
    recommendation:
      "Schedule DIMM replacement. Run `ipmitool sdr type Memory` to identify the affected slot. " +
      "Monitor for further growth; if errors persist on a replaced DIMM check the slot itself. " +
      OWNERSHIP_REMEDIATION_NOTE,
  }];
}
