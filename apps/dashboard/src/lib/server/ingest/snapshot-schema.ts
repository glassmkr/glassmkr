// Zod schema for Crucible snapshot ingestion (Phase 1: log-mode).
//
// Mirrors the `Snapshot` interface in `lib/server/alerts/evaluator.ts`,
// using `.passthrough()` so unknown fields don't reject. New collector
// versions can add fields without Dashboard needing a deploy in lockstep.
//
// In v1 of this rollout, validation runs in log-only mode: failures are
// recorded with structured field path + reason but the request still
// proceeds via the existing `as Snapshot` cast. After a two-week clean
// observation window, a follow-up commit flips this to reject mode.
//
// 2026-07 (audit R-1): the 14 capability-gated collector blocks the
// evaluator consumed but the schema never declared (ecc_edac, psi, vmstat,
// reboot_evidence, hardware_raid, process_fd, bonding, tcp_stats, lvm,
// ethtool, softnet, cve, dmesg_events, gpu) are now declared below, so the
// log-mode canary covers them. The root stays `.passthrough()`; the flip to
// `.strip()` + reject-mode with per-field caps is the still-deferred final
// step, gated on a clean observation window over these new blocks.
//
// Why log-mode first: a typo in the schema would break ingest for every
// agent in the field. Log-mode lets us detect schema/reality drift
// without taking the platform down. The `_validation_failures_total`
// metric (in validation-failures.ts) is the canary.

import { z } from "zod";

const SystemSchema = z.object({
  hostname: z.string(),
  ip: z.string(),
  os: z.string(),
  os_id: z.string().optional(),
  os_id_like: z.string().optional(),
  os_version_id: z.string().optional(),
  kernel: z.string(),
  uptime_seconds: z.number(),
}).passthrough();

const CpuCoreSchema = z.object({
  core: z.number(),
  user_percent: z.number(),
  system_percent: z.number(),
  iowait_percent: z.number(),
  idle_percent: z.number(),
}).passthrough();

const CpuSchema = z.object({
  user_percent: z.number(),
  system_percent: z.number(),
  iowait_percent: z.number(),
  idle_percent: z.number(),
  load_1m: z.number(),
  load_5m: z.number(),
  load_15m: z.number(),
  cores: z.array(CpuCoreSchema).optional(),
}).passthrough();

const MemorySchema = z.object({
  total_mb: z.number(),
  used_mb: z.number(),
  available_mb: z.number(),
  // free_mb (MemFree) added in Crucible 0.13.12; optional so pre-0.13.12
  // agents still validate. Lets the dashboard split headroom into
  // reclaimable cache (available - free) vs genuinely free.
  free_mb: z.number().optional(),
  swap_total_mb: z.number(),
  swap_used_mb: z.number(),
}).passthrough();

const DiskSchema = z.object({
  device: z.string(),
  mount: z.string(),
  total_gb: z.number(),
  used_gb: z.number(),
  available_gb: z.number(),
  percent_used: z.number(),
  io_read_mb_s: z.number().optional(),
  io_write_mb_s: z.number().optional(),
  latency_p99_ms: z.number().optional(),
  fstype: z.string().optional(),
  options: z.string().optional(),
  // Crucible 0.14.11+. Set only when the agent could not read the HOST mount table
  // (/proc/1/mounts) and fell back to its own namespace, where the unit's
  // ProtectSystem=strict shows `/` as read-only. When true, `options` describes the
  // sandbox rather than the host, so filesystem_readonly must abstain rather than
  // assert. Absent on healthy snapshots and on every pre-0.14.11 agent.
  options_unreliable: z.literal(true).optional(),
  inodes_total: z.number().optional(),
  inodes_used: z.number().optional(),
  inodes_free: z.number().optional(),
}).passthrough();

const SmartSchema = z.object({
  device: z.string(),
  model: z.string(),
  health: z.string(),
  // Crucible 0.14.0+: how the drive was reached. Omitted/"direct" for a normal
  // block device; a controller family ("megaraid", ...) for a physical drive
  // read through a hardware RAID/HBA via smartctl -d passthrough.
  transport: z.string().optional(),
  backing_device: z.string().optional(),
  temperature_c: z.number().optional(),
  percentage_used: z.number().optional(),
  reallocated_sectors: z.number().optional(),
  pending_sectors: z.number().optional(),
  power_on_hours: z.number().optional(),
  serial: z.string().optional(),
  firmware: z.string().optional(),
  // 2026-07 drive-health expansion (Crucible 0.13.25+): declared ahead of
  // the fleet roll so the eventual `.strip()` flip cannot silently drop
  // them. ATA raw counters plus the self-test log summary.
  reported_uncorrectable: z.number().optional(), // 187
  command_timeout: z.number().optional(), // 188
  high_fly_writes: z.number().optional(), // 189
  spin_retries: z.number().optional(), // 10
  reallocation_events: z.number().optional(), // 196
  offline_uncorrectable: z.number().optional(), // 198
  udma_crc_errors: z.number().optional(), // 199 (path/cabling, not media)
  media_errors: z.number().optional(),
  num_err_log_entries: z.number().optional(),
  self_test: z.object({
    last_type: z.string().optional(),
    last_status: z.string(),
    last_passed: z.boolean().optional(),
    last_lifetime_hours: z.number().optional(),
    last_failed_lba: z.number().optional(),
    last_failed_lifetime_hours: z.number().optional(),
    error_count_total: z.number().optional(),
  }).passthrough().optional(),
  // C17 NVMe fields the evaluator already consumes (nvme_critical_warning
  // rule) but the schema never declared; declared now for the same
  // strip-flip reason.
  critical_warning_raw: z.number().optional(),
  critical_warning_decoded: z.object({
    available_spare_low: z.boolean(),
    temperature_threshold: z.boolean(),
    reliability_degraded: z.boolean(),
    read_only: z.boolean(),
    volatile_memory_backup_failed: z.boolean(),
    persistent_memory_readonly: z.boolean(),
  }).passthrough().optional(),
  nvme_available_spare: z.number().optional(),
  nvme_available_spare_threshold: z.number().optional(),
}).passthrough();

const NetworkSchema = z.object({
  interface: z.string(),
  speed_mbps: z.number(),
  rx_bytes_sec: z.number(),
  tx_bytes_sec: z.number(),
  rx_errors: z.number(),
  tx_errors: z.number(),
  rx_drops: z.number(),
  tx_drops: z.number(),
  rx_packets: z.number().optional(),
  tx_packets: z.number().optional(),
  rx_crc_errors: z.number().optional(),
  rx_frame_errors: z.number().optional(),
  rx_length_errors: z.number().optional(),
  tx_carrier_errors: z.number().optional(),
  operstate: z.string().optional(),
  bond_master: z.string().optional(),
  is_bond_master: z.boolean().optional(),
}).passthrough();

const RaidSchema = z.object({
  device: z.string(),
  level: z.string(),
  status: z.string(),
  degraded: z.boolean(),
  disks: z.array(z.string()),
  failed_disks: z.array(z.string()),
}).passthrough();

const IpmiSensorSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string(),
  status: z.string(),
  upper_critical: z.number().optional(),
  type: z.string().optional(),
}).passthrough();

const IpmiSelEventSchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  sensor: z.string(),
  sensor_type: z.string(),
  event: z.string(),
  direction: z.string(),
  severity: z.string(),
}).passthrough();

const IpmiFanSchema = z.object({
  name: z.string(),
  rpm: z.number(),
  status: z.string(),
}).passthrough();

const IpmiSchema = z.object({
  available: z.boolean(),
  sensors: z.array(IpmiSensorSchema),
  // One-shot startup IPMI capability probe (Crucible 0.12.0+). Explains WHY
  // `available` is false: no BMC at all vs a BMC we are refusing or failing to
  // reach. Read by the ipmi_monitoring_unavailable evaluator, which fires for
  // every reason EXCEPT no_bmc_device. Optional: absent on pre-detection
  // agents, and the rule capability-gates on its presence.
  //
  // `reason` is deliberately a bounded string, not a z.enum of the five
  // reasons Crucible ships today. A newer agent adding a sixth reason must not
  // fail ingest validation for the whole snapshot, and an unrecognized reason
  // then fails LOUD (the rule reports the blind spot) rather than silently
  // classifying it as "no BMC" and hiding it.
  detection: z.object({
    available: z.boolean(),
    method: z.string().max(64).optional(),
    ipmitool_version: z.string().max(64).nullable().optional(),
    reason: z.string().max(64).optional(),
    detail: z.string().max(512).optional(),
    // Crucible 0.14.9+: the version reads below the CVE-2020-5208 floor but the
    // agent collected anyway. ADVISORY, not "vulnerable": most distros backport
    // the fix without bumping the upstream version. Deliberately has NO rule of
    // its own, because we cannot tell a patched 1.8.18 from an unpatched one and
    // a rule would therefore be a guess.
    ipmitool_below_cve_floor: z.boolean().optional(),
    // Crucible 0.14.10+. The distro package owning the root-executed ipmitool,
    // including the EVR (`ipmitool 1.8.18-11ubuntu2.2`). Only sent alongside
    // ipmitool_below_cve_floor, and it is the EVIDENCE for that flag now being
    // advisory rather than blocking: `ipmitool -V` reports a bare upstream
    // version, so this release suffix is the only visible sign that the distro
    // backported the CVE fix. Since 0.14.10 an UNATTRIBUTABLE below-floor binary
    // fails closed at the agent instead, arriving as
    // detection.reason "ipmitool_cve_2020_5208".
    ipmitool_package: z.string().max(200).optional(),
  }).passthrough().optional(),
  // Crucible 0.14.9+. The `/dev/ipmi*` node the kernel created, or null.
  // Re-checked EVERY snapshot, unlike `detection` which is one-shot at agent
  // start. A non-null value is positive evidence the host really has a BMC; null
  // means UNDETERMINED (ipmi_devintf may not be loaded), never "no BMC".
  bmc_device_node: z.string().max(128).nullable().optional(),
  // Crucible 0.14.9+. Outcome of THIS snapshot's IPMI collection. `skipped` means
  // the cached startup capability said unavailable so no ipmitool ran. Paired
  // with a non-null bmc_device_node, `failed` is the real "BMC present but not
  // answering" signal that ipmi_monitoring_unavailable now fires on.
  probe: z.object({
    status: z.string().max(16),
    detail: z.string().max(512).optional(),
  }).passthrough().optional(),
  // ECC counters from `ipmitool sensor`. `null` (Crucible 0.9.4+) when
  // the agent could not probe IPMI at all (no ipmitool, no /dev/ipmi0,
  // etc.). Distinguishes "BMC says zero" from "we couldn't ask". The
  // dashboard renders null as "no signal" rather than "0 / 0".
  // glassmkr#29 / cross-vendor IPMI audit Phase 1.
  ecc_errors: z.object({
    correctable: z.number(),
    uncorrectable: z.number(),
  }).passthrough().nullable(),
  // SEL-derived ECC counts (Crucible 0.8.0+). Dell iDRAC reports memory
  // ECC only via SEL on the Memory entity, so the named-sensor counter
  // stays at zero on Dell. The ecc_errors evaluator reads max(named, sel)
  // to cover both vendors. Optional because older agents pre-0.8.0 don't
  // populate it.
  ecc_errors_from_sel: z.object({
    correctable: z.number(),
    uncorrectable: z.number(),
    newest_event_timestamp: z.string().nullable(),
  }).passthrough().optional(),
  // `null` (Crucible 0.9.4+) when IPMI couldn't be probed; same
  // reasoning as `ecc_errors`.
  sel_entries_count: z.number().nullable(),
  sel_percent_used: z.number().nullable().optional(),
  sel_overflow: z.boolean().nullable().optional(),
  sel_events_recent: z.array(IpmiSelEventSchema).optional(),
  fans: z.array(IpmiFanSchema).optional(),
}).passthrough();

const OsAlertsSchema = z.object({
  oom_kills_recent: z.number(),
  zombie_processes: z.number(),
  time_drift_ms: z.number(),
}).passthrough();

const SecuritySchema = z.object({
  ssh: z.object({
    permitRootLogin: z.string(),
    passwordAuthentication: z.string(),
    rootPasswordExposed: z.boolean(),
    // Crucible v0.13.16+: false iff the on-disk sshd config is newer than
    // the running daemon's last (re)load. Optional for older agents.
    configApplied: z.boolean().optional(),
    configMtime: z.number().nullable().optional(),
    configLoadedAt: z.number().nullable().optional(),
  }).passthrough().nullable(),
  firewall: z.object({
    active: z.boolean(),
    source: z.string(),
    details: z.string(),
  }).passthrough(),
  pending_updates: z.object({
    distro: z.string(),
    pendingCount: z.number(),
    available: z.boolean(),
  }).passthrough().nullable(),
  kernel_vulns: z.array(z.object({
    name: z.string(),
    status: z.string(),
    mitigated: z.boolean(),
  }).passthrough()),
  kernel_reboot: z.object({
    running: z.string(),
    installed: z.string(),
    needsReboot: z.boolean(),
  }).passthrough().nullable(),
  auto_updates: z.object({
    configured: z.boolean(),
    mechanism: z.string(),
    details: z.string(),
  }).passthrough(),
}).passthrough();

// OS extended-support enrollment (Crucible 0.13.24+, support-status
// collector). Read by the os_end_of_life rule. Strings capped (R-1); the
// small enum-ish `source` and free-text `details` are the only strings.
const SupportStatusSchema = z.object({
  source: z.string().max(64),
  extended_support_active: z.boolean().nullable(),
  details: z.string().max(512),
  attached: z.boolean().optional(),
  esm_infra: z.boolean().optional(),
  esm_apps: z.boolean().optional(),
  eus: z.boolean().optional(),
}).passthrough();

const ZfsSchema = z.object({
  pools: z.array(z.object({
    name: z.string(),
    state: z.string(),
    errors_text: z.string(),
    scrub_errors: z.number().optional(),
    scrub_repaired: z.string().optional(),
    last_scrub_date: z.string().optional(),
    scrub_never_run: z.boolean().optional(),
  }).passthrough()),
}).passthrough();

const IoErrorsSchema = z.object({
  count: z.number(),
  devices: z.array(z.string()),
}).passthrough();

const IoLatencySchema = z.object({
  device: z.string(),
  avg_read_latency_ms: z.number().nullable(),
  avg_write_latency_ms: z.number().nullable(),
  read_iops: z.number(),
  write_iops: z.number(),
}).passthrough();

const ConntrackSchema = z.object({
  available: z.boolean(),
  count: z.number(),
  max: z.number(),
  percent: z.number(),
}).passthrough();

const SystemdSchema = z.object({
  failed_units: z.array(z.string()),
  failed_count: z.number(),
}).passthrough();

const NtpSchema = z.object({
  synced: z.boolean(),
  offset_seconds: z.number(),
  source: z.string(),
  daemon_running: z.boolean(),
  daemon_name: z.string().optional(),
}).passthrough();

const FileDescriptorsSchema = z.object({
  allocated: z.number(),
  free: z.number(),
  max: z.number(),
  percent: z.number(),
}).passthrough();

const ThermalReadingSchema = z.object({
  chip: z.string().optional(),
  label: z.string().optional(),
  // Nullable + optional: Crucible emits one ThermalReading per
  // detected hwmon chip even when that chip's sensor can't produce
  // a current value, and across the fleet the agent's emission
  // shape varies between {celsius: null} and {celsius absent} for
  // those unreadable chips. Both are sentinels for "chip exists,
  // value unavailable"; both should pass validation rather than
  // generate noise. Phase 1 detour found the null case (PR #60
  // shipped .nullable()); post-deploy verification of #60 surfaced
  // the absent case still produced `[ingest-validation] code=
  // invalid_type reason="Required"` — this `.optional()` closes
  // the remaining gap.
  celsius: z.number().nullable().optional(),
}).passthrough();

const ThermalSchema = z.object({
  available: z.boolean().optional(),
  source: z.string().optional(),
  max_cpu_celsius: z.number().nullable().optional(),
  cpu_readings: z.array(ThermalReadingSchema).optional(),
  other_readings: z.array(ThermalReadingSchema).optional(),
}).passthrough();

// DMI / SMBIOS hardware identification (Crucible 0.8.0+). Surfaces
// vendor, product, and BIOS info on the server tile + detail page.
// Optional because pre-0.8.0 agents don't emit it. Nullable strings
// because /sys/class/dmi/id files can be unreadable on virtualised
// hosts even when the block is present.
const DmiSchema = z.object({
  available: z.boolean(),
  vendor: z.string(),
  raw_vendor: z.string().nullable(),
  product_name: z.string().nullable(),
  bios_version: z.string().nullable(),
  bios_date: z.string().nullable(),
  is_virtual: z.boolean(),
}).passthrough();

// ---------------------------------------------------------------------------
// Capability-gated collector blocks (Crucible v0.11.0-v0.13.x). Declared for
// the log-mode canary (security audit R-1: the 14 fields the evaluator
// consumed but the schema never validated). Each mirrors its `Snapshot`
// interface in evaluator.ts, with ONE deliberate relaxation: the data
// containers are `.optional()`. Every one of these degrades to
// `{ available: false, reason }` on a host lacking the capability
// (non-NVIDIA, non-bonded, no LVM, kernel without PSI, ...) and on that path
// the agent omits the data arrays. Declaring them required would log a
// validation "failure" for the majority of the fleet and drown the drift
// canary this schema exists to read. `.passthrough()` keeps forward-compat
// with newer sub-fields, consistent with the rest of this file.

const PsiResourceSchema = z.object({
  avg10: z.number(), avg60: z.number(), avg300: z.number(), total: z.number(),
}).passthrough();
const PsiGroupSchema = z.object({
  some: PsiResourceSchema, full: PsiResourceSchema.optional(),
}).passthrough();
const PsiSchema = z.object({
  cpu: PsiGroupSchema.optional(),
  memory: PsiGroupSchema.optional(),
  io: PsiGroupSchema.optional(),
}).passthrough();

const EccEdacSchema = z.object({
  edac_corrected_total: z.number(),
  edac_uncorrected_total: z.number(),
  dimms: z.array(z.object({
    label: z.string(), location: z.string(), size_mb: z.number().nullable(),
    ce_count: z.number(), ue_count: z.number(),
  }).passthrough()),
}).passthrough();

// DIMM population topology from SMBIOS Type 17 (Crucible 0.13.19+,
// CC_SPEC_DIMM_POPULATION_2026-07-04). Slot count is bounded: the largest
// commodity boards ship 48 DIMM slots (dual-socket 12ch x 2DPC); 128 leaves
// headroom for 4-socket without letting a hostile payload send thousands.
const MemoryTopologySchema = z.object({
  source: z.string(),
  total_slots: z.number().min(0).max(1024),
  populated_slots: z.number().min(0).max(1024),
  available_channels: z.number().min(0).max(256),
  populated_channels: z.number().min(0).max(256),
  downclocked: z.boolean(),
  mixed_parts: z.boolean(),
  dimms: z.array(z.object({
    locator: z.string().max(64),
    bank_locator: z.string().max(64).nullable(),
    socket: z.number().nullable(), channel: z.string().max(8).nullable(),
    slot: z.number().nullable(), populated: z.boolean(),
    size_mb: z.number().nullable(), rank: z.number().nullable(),
    type: z.string().max(16).nullable(),
    speed_mts: z.number().nullable(), configured_mts: z.number().nullable(),
    manufacturer: z.string().max(64).nullable(), part_number: z.string().max(64).nullable(),
  }).passthrough()).max(128),
}).passthrough();

const VmstatSchema = z.object({
  pswpin_total: z.number(), pswpout_total: z.number(),
  pswpin_rate: z.number().nullable(), pswpout_rate: z.number().nullable(),
}).passthrough();

const RebootEvidenceSchema = z.object({
  pstore_present: z.boolean(), pstore_record_count: z.number(),
  vmcore_present: z.boolean(), wtmp_reboot_record: z.string().nullable(),
  prior_shutdown_clean: z.boolean(),
}).passthrough();

// Boot-config integrity (Crucible 1.2.0+, val-rocky postmortem). Loose shapes
// (nullable booleans, string root specs, capped entry array) so a newer agent
// cannot fail ingest for the whole snapshot. Read by boot_config_broken /
// boot_config_drift, both of which gate on `available`.
const BootConfigSchema = z.object({
  available: z.boolean(),
  error: z.string().max(500).optional(),
  mounted_root: z.object({
    source: z.string().max(200),
    uuid: z.string().max(200).nullable(),
    label: z.string().max(200).nullable(),
  }).passthrough().nullable(),
  cmdline_source: z.object({
    path: z.string().max(200),
    root_spec: z.string().max(200).nullable(),
    resolvable: z.boolean().nullable(),
    matches_mounted: z.boolean().nullable(),
  }).passthrough().nullable(),
  entries: z.array(z.object({
    source: z.string().max(40),
    title: z.string().max(300),
    kernel: z.string().max(120).nullable(),
    root_spec: z.string().max(200).nullable(),
    resolvable: z.boolean().nullable(),
    matches_mounted: z.boolean().nullable(),
    is_default: z.boolean(),
  }).passthrough()).max(64),
  default_entry_bootable: z.boolean().nullable(),
  default_entry_wrong_fs: z.boolean().nullable(),
  unbootable_entry_count: z.number(),
  source_regressed: z.boolean().nullable(),
}).passthrough();

const HardwareRaidSchema = z.object({
  controllers: z.array(z.object({
    vendor: z.enum(["dell", "hpe", "lsi", "adaptec"]),
    controller_id: z.string(), state: z.string(),
    degraded_disks: z.number().nullable(), raw_summary: z.string().nullable(),
  }).passthrough()),
}).passthrough();

const ProcessFdSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  top_consumers: z.array(z.object({
    pid: z.number(), comm: z.string(), fd_count: z.number(),
    rlimit_nofile_soft: z.number(), rlimit_nofile_hard: z.number(),
    percent_of_soft_limit: z.number(),
  }).passthrough()).optional(),
  total_processes_scanned: z.number().optional(),
  highest_percent_of_limit: z.number().nullable().optional(),
}).passthrough();

const BondingSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  bonds: z.array(z.object({
    name: z.string(), mode: z.string(), is_lacp: z.boolean(),
    lacp_rate: z.string().nullable(),
    slaves: z.array(z.object({
      name: z.string(), mii_status: z.string(), link_failure_count: z.number(),
      permanent_hw_addr: z.string(), aggregator_id: z.number().nullable(),
      partner_churn_state: z.string().nullable(),
      partner_lacp_port_state: z.number().nullable(),
      partner_lacp_synchronized: z.boolean().nullable(),
    }).passthrough()),
    configured_port_count: z.number(),
    active_aggregator: z.object({
      id: z.number(), number_of_ports: z.number(),
      actor_key: z.number().nullable(), partner_key: z.number().nullable(),
      partner_mac_address: z.string().nullable(),
    }).passthrough().nullable(),
  }).passthrough()).optional(),
}).passthrough();

const TcpStatsSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  out_segs_total: z.number().optional(),
  retrans_segs_total: z.number().optional(),
  in_segs_total: z.number().optional(),
  retrans_ratio: z.number().nullable().optional(),
  retrans_rate_per_sec: z.number().nullable().optional(),
  listen_overflows_total: z.number().optional(),
  listen_drops_total: z.number().optional(),
  listen_overflows_rate_per_sec: z.number().nullable().optional(),
  listen_drops_rate_per_sec: z.number().nullable().optional(),
}).passthrough();

const LvmSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  thin_pools: z.array(z.object({
    lv_name: z.string(), vg_name: z.string(),
    data_percent: z.number(), metadata_percent: z.number(),
  }).passthrough()).optional(),
}).passthrough();

const EthtoolSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  interfaces: z.array(z.object({
    iface: z.string(),
    advertised_auto_negotiation: z.boolean().nullable(),
    advertised_link_modes: z.array(z.string()),
  }).passthrough()).optional(),
}).passthrough();

const SoftnetSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  total_dropped_cumulative: z.number().optional(),
  per_cpu_dropped: z.array(z.number()).optional(),
  total_dropped_rate_per_sec: z.number().nullable().optional(),
}).passthrough();

const CveSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  distro: z.string().optional(),
  kernel_cves_pending: z.array(z.object({
    cve_id: z.string(),
    severity: z.enum(["critical", "important", "moderate", "low", "unknown"]),
    package_name: z.string(), fixed_version: z.string().optional(),
  }).passthrough()).optional(),
  total_critical_pending: z.number().optional(),
  total_important_pending: z.number().optional(),
  parser_quality: z.enum(["fleet-tested", "stub"]).optional(),
}).passthrough();

const DmesgEventsSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  events: z.array(z.object({
    timestamp_iso: z.string(),
    event_type: z.enum(["scsi_sense", "nvme_reset", "ext4_remount_readonly"]),
    severity: z.enum(["critical", "warning", "informational"]),
    details: z.record(z.union([z.string(), z.number(), z.boolean()])),
    raw_line: z.string(),
  }).passthrough()).optional(),
  events_by_type: z.record(z.number()).optional(),
  window_seconds: z.number().optional(),
}).passthrough();

// GPU (C19, Crucible v0.13.0+). tier1/2/3 are true `{available:true,...} |
// {available:false, reason}` unions in the interface, so they are modelled as
// z.union. The top-level `capabilities` block is `.optional()` for the same
// available:false degradation reason as the blocks above.
const GpuAvailableFalseSchema = z.object({
  available: z.literal(false), reason: z.string(),
}).passthrough();

const GpuTier1DeviceSchema = z.object({
  index: z.number(), uuid: z.string(), name: z.string(), pci_bdf: z.string(),
  vbios_version: z.string(),
  vram_total_mib: z.number(), vram_used_mib: z.number(),
  temp_c: z.number(), power_draw_w: z.number(), power_limit_w: z.number(),
  utilization_gpu_percent: z.number(), utilization_mem_percent: z.number(),
  clock_graphics_mhz: z.number(), clock_sm_mhz: z.number(), clock_mem_mhz: z.number(),
  pstate: z.string(),
  pcie_link_gen_current: z.number(), pcie_link_gen_max: z.number(),
  pcie_link_width_current: z.number(), pcie_link_width_max: z.number(),
  pcie_slot_max_width: z.number().nullable().optional(), // Crucible 0.13.23+: upstream-port (slot) max width
  ecc_mode_current: z.boolean(),
  ecc_errors_corrected_volatile: z.number(),
  ecc_errors_corrected_aggregate: z.number(),
  ecc_errors_uncorrected_volatile: z.number(),
  ecc_errors_uncorrected_aggregate: z.number(),
  retired_pages_single_bit: z.number().nullable(),
  retired_pages_double_bit: z.number().nullable(),
  retired_pages_pending: z.number().nullable(),
  thermal_slowdown_active: z.boolean(),
  thermal_violation_total_ms: z.number().nullable(),
  power_violation_total_ms: z.number().nullable(),
  fan_speed_percent: z.number().nullable(),
  nvlink_links: z.array(z.object({
    link_id: z.number(),
    state: z.enum(["up", "down", "inactive"]),
    speed_gbps: z.number(),
  }).passthrough()),
  performance_state_reasons: z.array(z.string()),
}).passthrough();

const GpuTier1Schema = z.union([
  z.object({
    available: z.literal(true),
    gpus: z.array(GpuTier1DeviceSchema),
    xid_events: z.array(z.object({
      timestamp_iso: z.string(), xid_code: z.number(), pci_bdf: z.string(),
      severity: z.enum(["critical", "warning", "info"]), raw_message: z.string(),
    }).passthrough()),
    driver_version: z.string(),
  }).passthrough(),
  GpuAvailableFalseSchema,
]);

const GpuTier2Schema = z.union([
  z.object({
    available: z.literal(true),
    parser_quality: z.enum(["stub", "fleet-tested"]),
    nvswitch_status: z.array(z.object({
      uuid: z.string(), port_count_total: z.number(),
      port_count_active: z.number(), port_count_faulted: z.number(),
      faulted_ports: z.array(z.number()),
    }).passthrough()),
    nvlink_detailed: z.array(z.object({
      link_id: z.number(), state: z.string(), speed_gbps: z.number(),
      remote_gpu_uuid: z.string().nullable(), remote_nvswitch_uuid: z.string().nullable(),
      replay_errors: z.number(), recovery_errors: z.number(),
      crc_errors: z.number(), flit_crc_errors: z.number(),
    }).passthrough()),
    retired_pages_detail: z.array(z.object({
      gpu_uuid: z.string(), address: z.string(),
      cause: z.enum(["single_bit_ecc", "double_bit_ecc"]), retired_at_iso: z.string(),
    }).passthrough()),
    thermal_violation_time_series_ms: z.number(),
    power_violation_time_series_ms: z.number(),
    health_summary_raw: z.string(),
  }).passthrough(),
  GpuAvailableFalseSchema,
]);

const GpuTier3Schema = z.union([
  z.object({
    available: z.literal(true),
    parser_quality: z.enum(["stub", "fleet-tested"]),
    oem_schema: z.string(),
  }).passthrough(),
  GpuAvailableFalseSchema,
]);

const GpuSchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  capabilities: z.object({
    nvidia_smi: z.boolean(),
    nvidia_driver_version: z.string().nullable(),
    dcgm: z.boolean(),
    dcgmi_version: z.string().nullable(),
    redfish_endpoint: z.string().nullable(),
    redfish_oem_schema: z.string().nullable(),
    probe_duration_ms: z.number(),
  }).passthrough().optional(),
  driver_resilience: z.object({
    nvidia_pci_present: z.boolean(),
    nvidia_module_loaded: z.boolean(),
    nouveau_module_loaded: z.boolean(),
    nouveau_blacklisted: z.boolean(),
  }).passthrough().optional(),
  tier1: GpuTier1Schema.optional(),
  tier2: GpuTier2Schema.optional(),
  tier3: GpuTier3Schema.optional(),
}).passthrough();

const LastPowerEventSchema = z.object({
  raw: z.string().max(200),
  present: z.boolean(),
  ac_failed: z.boolean(),
  power_overload: z.boolean(),
  power_interlock: z.boolean(),
  power_fault: z.boolean(),
  powered_on_by_command: z.boolean(),
  unrecognised_tokens: z.array(z.string().max(64)).max(16).optional(),
}).passthrough();

const RestartCauseSchema = z.object({
  raw: z.string().max(200),
  code: z.number().int().min(0).max(255).nullable(),
  label: z.string().max(64),
}).passthrough();

/** Crucible 0.15.0+. Chassis power provenance, stored as-is and interpreted nowhere
 *  in the ingest path. `last_power_event` is a decoded BIT SET, not a scalar, and a
 *  healthy host can legitimately assert `ac_failed`; `restart_cause` identifies a
 *  management path, not an actor. Feeds the reboot root-cause rollup once platforms
 *  are calibrated. Persisted via migrations/clickhouse/006_snapshot_chassis.sql. */
const ChassisSchema = z.object({
  last_power_event: LastPowerEventSchema.nullable(),
  restart_cause: RestartCauseSchema.nullable(),
  power_restore_policy: z.string().max(64).nullable(),
  power_overload_now: z.boolean().nullable(),
  main_power_fault_now: z.boolean().nullable(),
  power_control_fault_now: z.boolean().nullable(),
}).passthrough();

export const SnapshotSchema = z.object({
  // Required core fields. If any of these are wrong shape, the alert
  // evaluator will misbehave; log loudly.
  system: SystemSchema,
  chassis: ChassisSchema.optional(),
  cpu: CpuSchema,
  memory: MemorySchema,
  disks: z.array(DiskSchema),
  smart: z.array(SmartSchema),
  // Crucible 0.14.4+: fixed disks present in /sys/block whose SMART was
  // unreadable (smartctl missing / unsupported controller). Optional so older
  // agents omit it; capped defensively. Read by drive_smart_unreadable.
  smart_unreadable: z
    .array(z.object({ device: z.string().max(256), reason: z.string().max(64) }))
    .max(256)
    .optional(),
  network: z.array(NetworkSchema),
  raid: z.array(RaidSchema),
  ipmi: IpmiSchema,
  os_alerts: OsAlertsSchema,

  // Optional fields. Newer collector versions emit these; older ones
  // don't. Optional avoids spurious validation failures during the
  // migration window.
  security: SecuritySchema.optional(),
  support_status: SupportStatusSchema.optional(),
  zfs: ZfsSchema.optional(),
  io_errors: IoErrorsSchema.optional(),
  io_latency: z.array(IoLatencySchema).optional(),
  conntrack: ConntrackSchema.optional(),
  systemd: SystemdSchema.optional(),
  ntp: NtpSchema.optional(),
  file_descriptors: FileDescriptorsSchema.optional(),
  // Hwmon-derived CPU thermal data (Crucible 0.8.0+). Read by the
  // cpu_temperature_high evaluator's hwmon-primary path.
  thermal: ThermalSchema.optional(),
  // DMI / SMBIOS hardware identification (Crucible 0.8.0+). Surfaced
  // on the dashboard tile + server detail page. Dashboard stores
  // raw_vendor + product_name on servers (migration 012); the rest
  // round-trips through the ClickHouse blob.
  dmi: DmiSchema.optional(),

  // Capability-gated collector blocks (R-1 completion). Previously flowed
  // through `.passthrough()` unvalidated; now declared so the log-mode canary
  // sees type/enum drift on them too. All optional: any given host emits only
  // the blocks its kernel/hardware/CLI surface supports.
  ecc_edac: EccEdacSchema.optional(),
  memory_topology: MemoryTopologySchema.optional(),
  psi: PsiSchema.optional(),
  vmstat: VmstatSchema.optional(),
  reboot_evidence: RebootEvidenceSchema.optional(),
  boot_config: BootConfigSchema.optional(),
  hardware_raid: HardwareRaidSchema.optional(),
  process_fd: ProcessFdSchema.optional(),
  bonding: BondingSchema.optional(),
  tcp_stats: TcpStatsSchema.optional(),
  lvm: LvmSchema.optional(),
  ethtool: EthtoolSchema.optional(),
  softnet: SoftnetSchema.optional(),
  cve: CveSchema.optional(),
  dmesg_events: DmesgEventsSchema.optional(),
  gpu: GpuSchema.optional(),

  // Reboot lifecycle markers (set by Crucible after a planned reboot).
  expected_reboot: z.boolean().optional(),
  expected_reboot_reason: z.string().optional(),

  // Envelope fields used by the ingest handler (not part of the alert
  // evaluator Snapshot type, but present on the wire).
  collector_version: z.string().optional(),
  timestamp: z.string().optional(),
}).passthrough();

export type ParsedSnapshot = z.infer<typeof SnapshotSchema>;

export interface SnapshotParseResult {
  /** True if the payload validated cleanly. */
  ok: boolean;
  /** Structured field paths that failed, with their reason. NEVER
   *  contains the offending value (we don't log raw telemetry). */
  issues: Array<{ path: string; code: string; message: string }>;
}

/**
 * Validate a snapshot payload. Always succeeds: in log-mode (Phase 1
 * v1), validation never blocks the request. The caller continues with
 * the existing `as Snapshot` cast regardless of `ok`.
 *
 * The reject-mode flip lives in a follow-up commit after a clean
 * observation window.
 */
export function parseSnapshot(payload: unknown): SnapshotParseResult {
  const result = SnapshotSchema.safeParse(payload);
  if (result.success) {
    return { ok: true, issues: [] };
  }
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "<root>" : issue.path.join("."),
    code: issue.code,
    // zod messages don't echo the offending value by default; safe to
    // include verbatim.
    message: issue.message,
  }));
  return { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Hardened ingest parse (security audit 2026-05-22 §1.3 / catalog T-402,
// T-403, T-205).
//
// The Zod schema above runs in log-mode (it does not reject), and the root
// object stays .passthrough() for forward-compat, so neither Zod strict-mode
// nor schema-level .max() caps enforce anything at ingest today (the 14
// formerly-undeclared collector blocks are now declared above, but declaring
// them does not by itself reject oversize/unknown data while the root is
// passthrough + log-mode). These two guards are enforced at the JSON-parse
// boundary instead, independent of the log-mode rollout:
//
//   - Prototype-pollution (T-402): reject any payload containing a
//     __proto__ / constructor / prototype KEY. Node's JSON.parse already
//     treats these as own-properties (not prototype writes), and the
//     codebase has no deep-merge sink today, so this is defense-in-depth
//     -- but it makes a pollution attempt an explicit 400 + observable.
//   - Oversize string field (T-403 ReDoS / T-205 parser exhaustion): a
//     single 64 KB+ string value would feed the dmesg/SEL/smartctl regex
//     parsers a pathological input. The total body is already capped at
//     512 KB by adapter-node's BODY_SIZE_LIMIT; this bounds any SINGLE
//     field well below that. 64 KB is ~100x any legitimate field, so it
//     rejects only pathological inputs.
//
// Both run in a single reviver pass (no extra full-object walk). The
// caller maps IngestRejectError to a 400.

/** Per-string-field cap. Generous: ~100x any legitimate snapshot field. */
export const MAX_STRING_FIELD_BYTES = 64 * 1024;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class IngestRejectError extends Error {
  constructor(
    message: string,
    readonly reason: "prototype_pollution" | "oversize_field",
  ) {
    super(message);
    this.name = "IngestRejectError";
  }
}

/**
 * JSON.parse with a security reviver. Throws IngestRejectError on a
 * prototype-pollution key or an over-long string value. Throws a plain
 * SyntaxError on malformed JSON (same as JSON.parse). The body it
 * receives is already size-bounded by adapter-node's BODY_SIZE_LIMIT.
 */
export function safeJsonParse(text: string): unknown {
  return JSON.parse(text, (key, value) => {
    if (DANGEROUS_KEYS.has(key)) {
      throw new IngestRejectError(
        `rejected prototype-pollution key: ${key}`,
        "prototype_pollution",
      );
    }
    if (typeof value === "string" && value.length > MAX_STRING_FIELD_BYTES) {
      throw new IngestRejectError(
        `string field "${key}" exceeds ${MAX_STRING_FIELD_BYTES} bytes`,
        "oversize_field",
      );
    }
    return value;
  });
}
