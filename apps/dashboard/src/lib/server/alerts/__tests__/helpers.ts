// Shared test helpers for the alert evaluator. A healthy snapshot exercises
// every optional field so that tests can mutate a single slice without
// silently skipping rules that depend on optional data.

import type { Snapshot } from "../evaluator";

export function healthySnapshot(): Snapshot {
  return {
    system: { hostname: "test-1", ip: "10.0.0.1", os: "Ubuntu 24.04.4 LTS", kernel: "6.8.0-107-generic", uptime_seconds: 7 * 24 * 3600 },
    cpu: {
      user_percent: 10, system_percent: 3, iowait_percent: 1, idle_percent: 86,
      load_1m: 0.5, load_5m: 0.4, load_15m: 0.3,
      cores: Array.from({ length: 8 }, (_, i) => ({ core: i, user_percent: 10, system_percent: 3, iowait_percent: 1, idle_percent: 86 })),
    },
    memory: { total_mb: 16384, used_mb: 4096, available_mb: 12288, swap_total_mb: 4096, swap_used_mb: 128 },
    disks: [
      {
        device: "/dev/sda1", mount: "/", total_gb: 500, used_gb: 100, available_gb: 400, percent_used: 20,
        fstype: "ext4", options: "rw,relatime",
        inodes_total: 30_000_000, inodes_used: 500_000, inodes_free: 29_500_000,
      },
    ],
    smart: [
      { device: "/dev/sda", model: "Samsung SSD", health: "PASSED", temperature_c: 35, percentage_used: 5, reallocated_sectors: 0, pending_sectors: 0, power_on_hours: 1000 },
    ],
    network: [
      { interface: "eno1", speed_mbps: 10_000, rx_bytes_sec: 1_000_000, tx_bytes_sec: 500_000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
    ],
    raid: [
      { device: "md0", level: "raid1", status: "clean", degraded: false, disks: ["sda", "sdb"], failed_disks: [] },
    ],
    ipmi: {
      available: true,
      sensors: [
        { name: "CPU1 Temp", value: 45, unit: "C", status: "ok", upper_critical: 90 },
      ],
      ecc_errors: { correctable: 0, uncorrectable: 0 },
      sel_entries_count: 0,
      sel_events_recent: [],
      fans: [
        { name: "Fan1", rpm: 5000, status: "ok" },
        { name: "Fan2", rpm: 5000, status: "ok" },
      ],
    },
    os_alerts: { oom_kills_recent: 0, zombie_processes: 0, time_drift_ms: 10 },
    security: {
      ssh: { permitRootLogin: "prohibit-password", passwordAuthentication: "no", rootPasswordExposed: false },
      firewall: { active: true, source: "ufw", details: "UFW active" },
      pending_updates: { distro: "ubuntu", pendingCount: 0, available: true },
      kernel_vulns: [{ name: "spectre_v2", status: "Mitigation: Enhanced IBRS", mitigated: true }],
      kernel_reboot: { running: "6.8.0-107", installed: "6.8.0-107", needsReboot: false },
      auto_updates: { configured: true, mechanism: "unattended-upgrades", details: "unattended-upgrades active" },
    },
    zfs: {
      pools: [
        {
          name: "tank", state: "ONLINE", errors_text: "No known data errors",
          scrub_errors: 0, scrub_repaired: "0B",
          last_scrub_date: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
          scrub_never_run: false,
        },
      ],
    },
    io_errors: { count: 0, devices: [] },
    io_latency: [
      { device: "sda", avg_read_latency_ms: 1.5, avg_write_latency_ms: 2.0, read_iops: 100, write_iops: 50 },
    ],
    conntrack: { available: true, count: 1000, max: 262_144, percent: 0.4 },
    systemd: { failed_units: [], failed_count: 0 },
    ntp: { synced: true, offset_seconds: 0.002, source: "chrony", daemon_running: true, daemon_name: "chrony" },
    file_descriptors: { allocated: 1000, free: 100_000, max: 1_000_000, percent: 0.1 },
  };
}

// Structured clone works in node 17+. Vitest runs on modern node.
export function clone<T>(x: T): T {
  return structuredClone(x);
}
