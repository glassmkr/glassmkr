#!/usr/bin/env node
// Seed (or re-seed) the public read-only demo tenant.
//
// Creates a single customers row with is_demo = true and an anonymized
// sample fleet (Postgres servers + active_alerts) plus ~48h of ClickHouse
// snapshots so the REAL dashboard renders fully (panels, charts, alerts)
// when a visitor enters via /demo.
//
// Idempotent + namespaced: it only ever touches the is_demo tenant's data.
// Re-running deletes the demo servers (cascades alerts) + their CH
// snapshots, then re-inserts. It never reads or writes any real customer.
//
// Usage (on the services host, with the dashboard env loaded):
//   node scripts/seed-demo.mjs
// Env: DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD CLICKHOUSE_URL
//
// Safe to run before or after migration 024/025 are applied, but the
// is_demo column (024) and demo_leads table (025) must exist first.

import { Client as PgClient } from "pg";
import { createClient as createCh } from "@clickhouse/client";
import crypto from "node:crypto";

const DEMO_EMAIL = "demo@glassmkr.com";

// Verbatim copy of OWNERSHIP_REMEDIATION_NOTE from
// apps/dashboard/src/lib/alerts/vendor-facing.ts (the single source of truth).
// In production the evaluator appends this note to every vendor-side physical
// fault's recommendation; the "Generate ticket draft" button keys on its exact
// presence. The seed inserts canned recommendations (it bypasses the evaluator),
// so we append it here to one alert (the degraded RAID array, the canonical
// call-your-provider fault) so a demo visitor can try the feature. This is a
// plain .mjs script and cannot import the TS module; keep this string in sync if
// the note text ever changes (a demo re-seed would otherwise drop the button).
const OWNERSHIP_REMEDIATION_NOTE =
  "If you operate this hardware (owned or colocated): handle the inspection or swap yourself, or dispatch a remote-hands technician. If this is rented or provider-managed: file a hardware service ticket with your provider. Either way, the physical check needs to happen on-site.";

const pg = new PgClient({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "glassmkr",
  user: process.env.DB_USER || "agent",
  password: process.env.DB_PASSWORD || "agent",
});
const ch = createCh({
  url: process.env.CLICKHOUSE_URL || "http://127.0.0.1:8123",
  database: "glassmkr",
});

// ---- helpers ----
const cores = (n, profile) =>
  Array.from({ length: n }, (_, i) => {
    const busy = profile[i % profile.length];
    return {
      core: i,
      user_percent: +(busy * 0.7).toFixed(1),
      system_percent: +(busy * 0.25).toFixed(1),
      iowait_percent: +(busy * 0.05).toFixed(1),
      idle_percent: +(100 - busy).toFixed(1),
    };
  });

const a16Die = (index, bdf, temp, draw) => ({
  index, name: "NVIDIA A16",
  uuid: `GPU-${bdf.replace(/[:.]/g, "").slice(0, 8)}-demo-${index}`,
  pci_bdf: bdf, temp_c: temp, power_draw_w: draw, power_limit_w: 62.5,
  vram_used_mib: 12, vram_total_mib: 15356, ecc_mode_current: true,
  ecc_errors_corrected_aggregate: 0, ecc_errors_uncorrected_aggregate: 0,
  retired_pages_double_bit: 0, retired_pages_pending: 0,
  pcie_link_gen_current: 4, pcie_link_gen_max: 4,
  pcie_link_width_current: 16, pcie_link_width_max: 16,
  performance_state_reasons: ["gpu_idle"], nvlink_links: [],
});

// Each fleet member: PG row fields + a function producing a snapshot blob
// at a given point in time (t = 0..1 across the 48h window for variation).
const FLEET = [
  {
    id: "srv_demo_gpu_ams_a16",
    name: "gpu-ams-a16-01", hostname: "gpu-ams-a16-01", ip: "10.40.2.11",
    os_type: "debian", os_version: "13", os_id: "debian", os_version_id: "13",
    dmi_vendor: "Supermicro", dmi_product: "AS-2015A-TR", ipmi_sensors_count: 14, gpu_count: 8,
    snap: (t) => ({
      cpu_user_percent: 0.6 + Math.sin(t * 6) * 0.4, cpu_system_percent: 0.4,
      cpu_iowait_percent: 0.1, cpu_idle_percent: 98.9,
      cpu_cores: cores(16, [1, 2, 1, 3, 1, 2, 1, 5, 1, 2, 1, 2, 1, 3, 1, 1]),
      load_1m: 0.18, load_5m: 0.22, load_15m: 0.2,
      ram_total_mb: 64200, ram_used_mb: 5020 + Math.round(Math.sin(t * 5) * 400),
      ram_available_mb: 59180, swap_total_mb: 8192, swap_used_mb: 0,
      disks: [
        { mount: "/", used_gb: 18.2, total_gb: 100, percent_used: 18.2 },
        { mount: "/data", used_gb: 240, total_gb: 1800, percent_used: 13.3 },
      ],
      smart: [
        { device: "/dev/sda", model: "Samsung SSD 870 EVO 1TB", health: "PASSED", temperature_c: 32, power_on_hours: 9890, reallocated_sectors: 0 },
        { device: "/dev/nvme0n1", model: "Micron 7450 PRO 1.9TB", health: "PASSED", temperature_c: 41, power_on_hours: 7200, reallocated_sectors: 0 },
      ],
      network: [
        { interface: "eno1", speed_mbps: 10000, rx_bytes_sec: 1050000, tx_bytes_sec: 520000, rx_packets: 8400000, tx_packets: 6100000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
        { interface: "eno2", speed_mbps: 1000, rx_bytes_sec: 8000, tx_bytes_sec: 4000, rx_packets: 410000, tx_packets: 280000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
        // Unplugged onboard port: no carrier, so no negotiated link speed.
        // Drives the "Show interfaces with no link speed" collapse in the demo.
        { interface: "enp1s0f1", rx_bytes_sec: 0, tx_bytes_sec: 0, rx_packets: 0, tx_packets: 0, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
      ],
      ipmi: {
        available: true, ecc_errors: { correctable: 0, uncorrectable: 0 },
        sensors: [
          { name: "CPU1 Temp", value: 38, unit: "degrees C" }, { name: "CPU2 Temp", value: 41, unit: "degrees C" },
          { name: "System Temp", value: 29, unit: "degrees C" }, { name: "Peripheral Temp", value: 36, unit: "degrees C" },
          { name: "VRM Temp", value: 44, unit: "degrees C" },
          { name: "FAN1", value: 5800, unit: "RPM" }, { name: "FAN2", value: 5700, unit: "RPM" },
          { name: "FAN3", value: 5900, unit: "RPM" }, { name: "FAN4", value: 5750, unit: "RPM" }, { name: "FANA", value: 3600, unit: "RPM" },
          { name: "PSU1 Power", value: 168, unit: "Watts" }, { name: "PSU2 Power", value: 161, unit: "Watts" },
          { name: "12V", value: 12.1, unit: "Volts" }, { name: "5V", value: 5.02, unit: "Volts" },
        ],
      },
      gpu: { tier1: { available: true, driver_version: "550.163.01", gpus: [a16Die(0, "00000000:01:00.0", 36, 12.25), a16Die(1, "00000000:25:00.0", 38, 12.3)], xid_events: [] }, tier2: { available: false, reason: "nv-hostengine not running" }, tier3: null },
      security: { ssh_root_login: false, firewall: true, updates_available: 3, auto_updates: true },
    }),
    alerts: [],
    trends: [
      {
        warning_type: "smart_wearout_growing", resource_identifier: "drive:/dev/nvme0n1",
        severity: "medium", urgency_tier: "watch",
        evidence_summary: "Micron 7450 PRO media-wear indicator reached 6% after 7,200 power-on hours. Well within its endurance rating; surfaced only so the replacement budget cycle can plan ahead.",
        projected_timeline: "many months of headroom",
        contributing_metrics: { attribute: "percentage_used", latest_value: 6, power_on_hours: 7200 },
        tree_ranker_score: 0.31, first_detected_days_ago: 9, consecutive_batches_seen: 9,
      },
    ],
  },
  {
    id: "srv_demo_db_hel1",
    name: "db-hel1-01", hostname: "db-hel1-01", ip: "10.20.0.5",
    os_type: "rocky", os_version: "9.4", os_id: "rocky", os_version_id: "9.4",
    dmi_vendor: "Supermicro", dmi_product: "SSG-620P", ipmi_sensors_count: 9, gpu_count: 0,
    snap: (t) => ({
      cpu_user_percent: 22 + Math.sin(t * 7) * 6, cpu_system_percent: 9, cpu_iowait_percent: 11.8, cpu_idle_percent: 57,
      cpu_cores: cores(32, [30, 42, 28, 51, 22, 38, 44, 19, 33, 47, 25, 40, 36, 29, 55, 21, 31, 43, 27, 39, 24, 41, 35, 20, 48, 26, 37, 32, 23, 45, 34, 28]),
      load_1m: 14.2, load_5m: 12.8, load_15m: 11.1,
      ram_total_mb: 262144, ram_used_mb: 230000 + Math.round(Math.sin(t * 4) * 4000), ram_available_mb: 32144, swap_total_mb: 16384, swap_used_mb: 1800,
      disks: [
        { mount: "/", used_gb: 40, total_gb: 100, percent_used: 40 },
        { mount: "/var/lib/pgsql", used_gb: 6800, total_gb: 8000, percent_used: 85 },
      ],
      smart: [
        { device: "/dev/sda", model: "Seagate Exos X18 16TB", health: "PASSED", temperature_c: 38, power_on_hours: 26400, reallocated_sectors: 0 },
        { device: "/dev/sdd", model: "Seagate Exos X18 16TB", health: "FAILED", temperature_c: 45, power_on_hours: 26380, reallocated_sectors: 1184 },
      ],
      network: [
        { interface: "bond0", is_bond_master: true, speed_mbps: 20000, rx_bytes_sec: 180000000, tx_bytes_sec: 140000000, rx_packets: 90000000, tx_packets: 80000000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
        { interface: "eno1", bond_master: "bond0", speed_mbps: 10000, rx_bytes_sec: 92000000, tx_bytes_sec: 70000000, rx_packets: 46000000, tx_packets: 40000000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
      ],
      ipmi: {
        available: true, ecc_errors: { correctable: 7, uncorrectable: 0 },
        sensors: [
          { name: "CPU1 Temp", value: 58, unit: "degrees C" }, { name: "CPU2 Temp", value: 61, unit: "degrees C" }, { name: "System Temp", value: 33, unit: "degrees C" },
          { name: "FAN1", value: 7200, unit: "RPM" }, { name: "FAN2", value: 7080, unit: "RPM" }, { name: "FAN3", value: 7320, unit: "RPM" }, { name: "FAN4", value: 7150, unit: "RPM" },
          { name: "PSU1 Power", value: 410, unit: "Watts" }, { name: "PSU2 Power", value: 398, unit: "Watts" },
        ],
      },
      gpu: null,
      security: { ssh_root_login: false, firewall: true, updates_available: 12, auto_updates: false },
    }),
    alerts: [
      { alert_type: "raid_degraded", severity: "critical", title: "RAID array degraded (md0)", message: "md0 (RAID10) is running degraded: 1 of 6 devices failed (/dev/sdd). Array is still online; rebuild has not started (no spare).", recommendation: `Replace /dev/sdd and re-add it to the array, then watch the rebuild. ${OWNERSHIP_REMEDIATION_NOTE}` },
      { alert_type: "memory_pressure_high", severity: "warning", title: "Memory usage above 85%", message: "Used memory is 88% of total. Available has dropped below 12% for 40 minutes.", recommendation: "Check for a memory leak in the top RSS process before it hits swap pressure." },
    ],
    trends: [
      {
        warning_type: "smart_187_growing", resource_identifier: "drive:/dev/sda",
        severity: "high", urgency_tier: "imminent",
        evidence_summary: "Reported-uncorrectable count (SMART 187) on /dev/sda climbed from 0 to 24 over the last 6 days and the slope is steepening. Drives that begin logging 187 errors frequently fail within two weeks.",
        projected_timeline: "likely within 7-14 days",
        contributing_metrics: { attribute: "187_reported_uncorrect", first_value: 0, latest_value: 24, window_days: 6, slope_per_day: 4 },
        tree_ranker_score: 0.82, first_detected_days_ago: 6, consecutive_batches_seen: 6,
      },
      {
        warning_type: "disk_space_growing", resource_identifier: "mount:/var/lib/pgsql",
        severity: "medium", urgency_tier: "soon",
        evidence_summary: "/var/lib/pgsql usage rose from 71% to 85% over 14 days. At the current fill rate it reaches 90% in roughly 9 days, where autovacuum headroom starts to get tight.",
        projected_timeline: "about 9 days to 90%",
        contributing_metrics: { mount: "/var/lib/pgsql", first_pct: 71, latest_pct: 85, window_days: 14 },
        tree_ranker_score: null, first_detected_days_ago: 14, consecutive_batches_seen: 14,
      },
    ],
  },
  {
    id: "srv_demo_web_fsn1",
    name: "web-fsn1-03", hostname: "web-fsn1-03", ip: "10.10.1.23",
    os_type: "ubuntu", os_version: "24.04", os_id: "ubuntu", os_version_id: "24.04",
    dmi_vendor: "Dell", dmi_product: "PowerEdge R6525", ipmi_sensors_count: 7, gpu_count: 0,
    snap: (t) => ({
      cpu_user_percent: 56 + Math.sin(t * 9) * 10, cpu_system_percent: 14, cpu_iowait_percent: 2.3, cpu_idle_percent: 26,
      cpu_cores: cores(8, [72, 81, 64, 77, 69, 88, 71, 60]),
      load_1m: 6.4, load_5m: 5.9, load_15m: 4.8,
      ram_total_mb: 32768, ram_used_mb: 21800 + Math.round(Math.sin(t * 6) * 1500), ram_available_mb: 10968, swap_total_mb: 4096, swap_used_mb: 240,
      disks: [{ mount: "/", used_gb: 62, total_gb: 200, percent_used: 31 }],
      smart: [{ device: "/dev/nvme0n1", model: "Dell Ent NVMe 960GB", health: "PASSED", temperature_c: 44, power_on_hours: 21030, reallocated_sectors: 0 }],
      network: [{ interface: "eno1", speed_mbps: 10000, rx_bytes_sec: 42000000, tx_bytes_sec: 88000000, rx_packets: 51000000, tx_packets: 60000000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 }],
      ipmi: {
        available: true, ecc_errors: { correctable: 0, uncorrectable: 0 },
        sensors: [
          { name: "Inlet Temp", value: 24, unit: "degrees C" }, { name: "CPU Temp", value: 67, unit: "degrees C" }, { name: "Exhaust Temp", value: 48, unit: "degrees C" },
          { name: "FAN1", value: 9120, unit: "RPM" }, { name: "FAN2", value: 9000, unit: "RPM" }, { name: "FAN3", value: 9240, unit: "RPM" },
          { name: "Pwr Consumption", value: 312, unit: "Watts" },
        ],
      },
      gpu: null,
      security: { ssh_root_login: false, firewall: true, updates_available: 0, auto_updates: true },
    }),
    alerts: [
      { alert_type: "cpu_high", severity: "warning", title: "CPU sustained above 70%", message: "Aggregate CPU has held above 70% for 18 minutes. Top process: gunicorn (PID 2841).", recommendation: "Confirm the load is expected; if not, profile the top process or scale out." },
    ],
    trends: [
      {
        warning_type: "memory_growth_trend", resource_identifier: "host:web-fsn1-03",
        severity: "medium", urgency_tier: "scheduled",
        evidence_summary: "Baseline memory use (after cache) drifted from 58% to 67% over 21 days. No single process dominates, so this reads as gradual working-set growth rather than a leak. Headroom is shrinking but not yet critical.",
        projected_timeline: "weeks, not days",
        contributing_metrics: { first_pct: 58, latest_pct: 67, window_days: 21 },
        tree_ranker_score: null, first_detected_days_ago: 21, consecutive_batches_seen: 21,
      },
    ],
  },
  {
    id: "srv_demo_edge_sjc",
    name: "edge-sjc-02", hostname: "edge-sjc-02", ip: "10.30.4.7",
    os_type: "debian", os_version: "12", os_id: "debian", os_version_id: "12",
    dmi_vendor: "HPE", dmi_product: "ProLiant DL20 Gen11", ipmi_sensors_count: 0, gpu_count: 0,
    snap: (t) => ({
      cpu_user_percent: 8 + Math.sin(t * 5) * 3, cpu_system_percent: 4, cpu_iowait_percent: 0.4, cpu_idle_percent: 87.5,
      cpu_cores: cores(4, [12, 18, 9, 14]),
      load_1m: 0.62, load_5m: 0.71, load_15m: 0.55,
      ram_total_mb: 16384, ram_used_mb: 3800 + Math.round(Math.sin(t * 7) * 300), ram_available_mb: 12584, swap_total_mb: 2048, swap_used_mb: 0,
      disks: [{ mount: "/", used_gb: 28, total_gb: 120, percent_used: 23.3 }],
      smart: [{ device: "/dev/sda", model: "Intel S4520 480GB", health: "PASSED", temperature_c: 35, power_on_hours: 4100, reallocated_sectors: 0 }],
      network: [
        { interface: "eno1", speed_mbps: 1000, rx_bytes_sec: 18000000, tx_bytes_sec: 24000000, rx_packets: 12000000, tx_packets: 14000000, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0 },
        { interface: "eno2", speed_mbps: 1000, rx_bytes_sec: 6000000, tx_bytes_sec: 2000000, rx_packets: 2400000, tx_packets: 1900000, rx_errors: 140, tx_errors: 0, rx_crc_errors: 20, rx_drops: 90, tx_drops: 0 },
      ],
      ipmi: { available: false, detection: { reason: "no_bmc_device" } },
      gpu: null,
      security: { ssh_root_login: false, firewall: true, updates_available: 1, auto_updates: true },
    }),
    alerts: [
      { alert_type: "interface_errors", severity: "warning", title: "NIC errors on eno2", message: "eno2 has accumulated 160 hardware errors (CRC + frame) and 90 discards. Error ratio exceeds 0.1% of packets. Check cabling / SFP.", recommendation: "Reseat the cable / SFP on eno2; if errors persist, swap the transceiver." },
    ],
    trends: [
      {
        warning_type: "interface_errors_trend", resource_identifier: "iface:eno2",
        severity: "medium", urgency_tier: "soon",
        evidence_summary: "Hardware errors on eno2 grew steadily for 4 days before the interface_errors alert fired. The early-warning slope matched the eventual alert, so the cabling/SFP issue could have been scheduled rather than waited on.",
        projected_timeline: "already materialised into an alert",
        contributing_metrics: { iface: "eno2", first_errors: 0, latest_errors: 160, window_days: 4 },
        tree_ranker_score: null, first_detected_days_ago: 7, consecutive_batches_seen: 5,
        acknowledged: { days_ago: 3, feedback: "valuable" },
      },
    ],
  },
];

function chTs(d) {
  return d.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}

async function main() {
  await pg.connect();
  console.log("[seed-demo] connected to Postgres");

  // 1) Upsert the demo customer (is_demo=true, verified, pro plan so 90d
  //    retention + GPU/trend surfaces show). Unusable password hash so the
  //    tenant can only ever be entered via /demo, never password login.
  const unusableHash = "demo-no-login-" + crypto.randomBytes(16).toString("hex");
  const custRes = await pg.query(
    `INSERT INTO customers (email, password_hash, display_name, email_verified, status, plan, plan_retention_days, is_demo)
     VALUES ($1, $2, 'Demo Fleet', true, 'active', 'pro', 90, true)
     ON CONFLICT (email) DO UPDATE SET is_demo = true, plan = 'pro', plan_retention_days = 90, email_verified = true
     RETURNING id`,
    [DEMO_EMAIL, unusableHash],
  );
  const customerId = custRes.rows[0].id;
  console.log(`[seed-demo] demo customer ${customerId}`);

  // 2) Clean prior demo servers (cascades active_alerts) + their CH snapshots.
  const old = await pg.query(`SELECT id FROM servers WHERE customer_id = $1`, [customerId]);
  for (const r of old.rows) {
    await ch.command({ query: `ALTER TABLE glassmkr.snapshots DELETE WHERE server_id = {sid:String}`, query_params: { sid: r.id } }).catch(() => {});
  }
  await pg.query(`DELETE FROM servers WHERE customer_id = $1`, [customerId]);
  console.log(`[seed-demo] cleared ${old.rows.length} prior demo server(s)`);

  // 3) Insert servers + alerts + ~30 days of snapshots (30-min cadence) so the
  //    history charts populate across every range (1h..30d) and don't age out
  //    of the 24h window between re-seeds as quickly as a 48h window did.
  const now = Date.now();
  const POINTS = 1440; // 30 days @ 30 min
  for (const s of FLEET) {
    await pg.query(
      `INSERT INTO servers (id, customer_id, name, hostname, ip, os_type, os_version, os_id, os_version_id,
         api_key_hash, status, last_seen_at, collector_version, dmi_vendor, dmi_product, ipmi_sensors_count, gpu_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'demo-no-ingest','active',NOW(),'0.13.6',$10,$11,$12,$13)`,
      [s.id, customerId, s.name, s.hostname, s.ip, s.os_type, s.os_version, s.os_id, s.os_version_id,
       s.dmi_vendor, s.dmi_product, s.ipmi_sensors_count, s.gpu_count],
    );

    for (const a of s.alerts) {
      // No ON CONFLICT: the prior demo servers (and their alerts via FK
      // cascade) were deleted above, so each run inserts into a clean slate.
      // (active_alerts' uniqueness changed with the incident-grouping
      // migration, so a (server_id, alert_type) conflict target is invalid.)
      await pg.query(
        `INSERT INTO active_alerts (server_id, alert_type, severity, title, message, recommendation, first_seen, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6, NOW() - INTERVAL '2 hours', NOW())`,
        [s.id, a.alert_type, a.severity, a.title, a.message, a.recommendation],
      );
    }

    // Trend warnings (early-warning signals). Active rows have no notified_at
    // so they don't surface in the "Pending feedback" tab; the one tagged
    // `acknowledged` gets dismissed_at + feedback so the Acknowledged tab is
    // populated too. Cleared automatically on re-seed via servers FK cascade.
    const DAY = 86400000;
    for (const t of s.trends ?? []) {
      const ack = t.acknowledged;
      const firstDetectedAt = new Date(now - (t.first_detected_days_ago ?? 7) * DAY);
      const dismissedAt = ack ? new Date(now - ack.days_ago * DAY) : null;
      const notifiedAt = ack ? new Date(now - (ack.days_ago + 2) * DAY) : null;
      await pg.query(
        `INSERT INTO trend_warnings
           (server_id, warning_type, resource_identifier, severity, urgency_tier,
            tree_ranker_score, contributing_metrics, evidence_summary, projected_timeline,
            first_detected_at, last_updated_at, consecutive_batches_seen,
            notified_at, dismissed_at, dismissed_by_user_id, user_feedback, user_feedback_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12,$13,$14,$15,$16)`,
        [s.id, t.warning_type, t.resource_identifier, t.severity, t.urgency_tier,
         t.tree_ranker_score ?? null, JSON.stringify(t.contributing_metrics), t.evidence_summary, t.projected_timeline ?? null,
         firstDetectedAt, t.consecutive_batches_seen ?? 3,
         notifiedAt, dismissedAt, ack ? customerId : null, ack ? ack.feedback : null, ack ? dismissedAt : null],
      );
    }

    const rows = [];
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1);
      const ts = new Date(now - (POINTS - 1 - i) * 30 * 60 * 1000);
      const b = s.snap(t);
      // CPU die temp (hwmon): reuse the IPMI CPU sensor when present, else a
      // sane idle-ish default. Powers the CPU-temp tile + its history (the
      // thermal column, migration 003).
      const cpuTempSensor = (b.ipmi?.sensors ?? []).find((x) => /cpu/i.test(x.name ?? "") && x.unit === "degrees C");
      const maxCpuC = +(((cpuTempSensor ? Number(cpuTempSensor.value) + 2 : 48)) + Math.sin(t * 5) * 1.5).toFixed(1);
      rows.push({
        server_id: s.id, timestamp: chTs(ts), collector_version: "0.13.6",
        hostname: s.hostname, ip: s.ip, os: `${s.os_type} ${s.os_version}`, kernel: "6.x", uptime_seconds: 1036800 + i * 1800,
        cpu_user_percent: +b.cpu_user_percent.toFixed(2), cpu_system_percent: b.cpu_system_percent,
        cpu_iowait_percent: b.cpu_iowait_percent, cpu_idle_percent: b.cpu_idle_percent,
        cpu_cores: JSON.stringify(b.cpu_cores),
        load_1m: b.load_1m, load_5m: b.load_5m, load_15m: b.load_15m,
        ram_total_mb: b.ram_total_mb, ram_used_mb: b.ram_used_mb, ram_available_mb: b.ram_available_mb,
        // free_mb (Crucible 0.13.12): ~45% of available is genuinely free, the
        // rest reclaimable cache -> the memory tile's Used / Cache / Free split.
        ram_free_mb: Math.round(b.ram_available_mb * 0.45),
        swap_total_mb: b.swap_total_mb, swap_used_mb: b.swap_used_mb,
        disks: JSON.stringify(b.disks), smart: JSON.stringify(b.smart), network: JSON.stringify(b.network),
        raid: "", ipmi: JSON.stringify(b.ipmi),
        thermal: JSON.stringify({ available: true, source: "hwmon coretemp Package id 0", max_cpu_celsius: maxCpuC, cpu_readings: [{ label: "Package id 0", celsius: maxCpuC }] }),
        oom_kills_recent: 0, zombie_processes: 0, time_drift_ms: 2.0,
        security: JSON.stringify(b.security), gpu: b.gpu ? JSON.stringify(b.gpu) : "",
      });
    }
    await ch.insert({ table: "snapshots", values: rows, format: "JSONEachRow" });
    console.log(`[seed-demo] ${s.name}: ${rows.length} snapshots, ${s.alerts.length} alert(s), ${(s.trends ?? []).length} trend warning(s)`);
  }

  await ch.close();
  await pg.end();
  console.log("[seed-demo] done. Enter the demo at /demo.");
}

main().catch((err) => {
  console.error("[seed-demo] FAILED:", err);
  process.exit(1);
});
