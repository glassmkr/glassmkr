// Tests for the C7-C10 Crucible activation shipped 2026-05-19:
//   fd_exhaustion per-process path (C7)
//   conntrack_exhaustion insert_failed signal (C9)
//   lacp_partner_lost new rule (C8)
//   tcp_retrans_high new rule (C10)
//   listen_overflow new rule (C10)
//
// Per CC_SPEC_FORGE_C7_C10_ACTIVATION_2026-05-19.md.

import { describe, expect, it } from "vitest";

import { evaluateAlerts, type AlertResult, type Snapshot } from "../evaluator";
import { healthySnapshot } from "./helpers";

function alertsByType(snap: Snapshot, type: string): AlertResult[] {
  return evaluateAlerts(snap).filter((a) => a.type === type);
}

// ============================================================================
// fd_exhaustion per-process extension
// ============================================================================

describe("fd_exhaustion per-process path (C7)", () => {
  it("emits warning when a process is at 80% of soft limit", () => {
    const s = healthySnapshot();
    s.process_fd = {
      available: true,
      top_consumers: [
        {
          pid: 1234,
          comm: "leaky-app",
          fd_count: 820,
          rlimit_nofile_soft: 1024,
          rlimit_nofile_hard: 4096,
          percent_of_soft_limit: 80.1,
        },
      ],
      total_processes_scanned: 250,
      highest_percent_of_limit: 80.1,
    };
    const fired = alertsByType(s, "fd_exhaustion");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.scope).toBe("per_process");
    expect(fired[0].evidence.comm).toBe("leaky-app");
    expect(fired[0].evidence.pid).toBe(1234);
  });

  it("emits critical when a process is at 95%+ of soft limit", () => {
    const s = healthySnapshot();
    s.process_fd = {
      available: true,
      top_consumers: [
        {
          pid: 9999,
          comm: "very-leaky",
          fd_count: 980,
          rlimit_nofile_soft: 1024,
          rlimit_nofile_hard: 4096,
          percent_of_soft_limit: 95.7,
        },
      ],
      total_processes_scanned: 250,
      highest_percent_of_limit: 95.7,
    };
    const fired = alertsByType(s, "fd_exhaustion");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });

  it("emits per-process for each process above threshold", () => {
    const s = healthySnapshot();
    s.process_fd = {
      available: true,
      top_consumers: [
        { pid: 1, comm: "a", fd_count: 850, rlimit_nofile_soft: 1024, rlimit_nofile_hard: 4096, percent_of_soft_limit: 83.0 },
        { pid: 2, comm: "b", fd_count: 980, rlimit_nofile_soft: 1024, rlimit_nofile_hard: 4096, percent_of_soft_limit: 95.7 },
        { pid: 3, comm: "c", fd_count: 100, rlimit_nofile_soft: 1024, rlimit_nofile_hard: 4096, percent_of_soft_limit: 9.7 },
      ],
      total_processes_scanned: 200,
      highest_percent_of_limit: 95.7,
    };
    const fired = alertsByType(s, "fd_exhaustion");
    expect(fired.length).toBe(2);
    const severities = fired.map((f) => f.severity).sort();
    expect(severities).toEqual(["critical", "warning"]);
  });

  it("skips processes with soft limit 0 (the 'unlimited' sentinel)", () => {
    const s = healthySnapshot();
    s.process_fd = {
      available: true,
      top_consumers: [
        { pid: 1, comm: "root-proc", fd_count: 5000, rlimit_nofile_soft: 0, rlimit_nofile_hard: 0, percent_of_soft_limit: 0 },
      ],
      total_processes_scanned: 100,
      highest_percent_of_limit: 0,
    };
    expect(alertsByType(s, "fd_exhaustion").length).toBe(0);
  });

  // Regression: campaign finding 2026-05-20 on val-RTXA4000. OpenSSH 9.8+
  // sets RLIMIT_NOFILE=1 on the sshd-auth privsep child after that stage
  // has opened its handful of fds. Crucible accurately reports 6 fds / 1
  // soft limit = 600%, but the kernel doesn't retroactively close the
  // already-open fds and the process doesn't grow its fd set; the alert
  // re-fires every snapshot as permanent noise. The rule now skips
  // processes whose soft limit is below a sanity floor (< 16) since any
  // value below the OS default (1024) is categorical intentional hardening.
  it("skips processes with deliberately-hardened soft limits (e.g. OpenSSH sshd-auth at soft=1)", () => {
    const s = healthySnapshot();
    s.process_fd = {
      available: true,
      top_consumers: [
        // Exact shape observed on val-RTXA4000 under OpenSSH 10.0p2.
        { pid: 9158, comm: "sshd-auth", fd_count: 6, rlimit_nofile_soft: 1, rlimit_nofile_hard: 1, percent_of_soft_limit: 600.0 },
        // Other deliberately-hardened limits we'd expect in the wild.
        { pid: 9200, comm: "sshd-session-net", fd_count: 5, rlimit_nofile_soft: 4, rlimit_nofile_hard: 4, percent_of_soft_limit: 125.0 },
        { pid: 9300, comm: "uwsgi", fd_count: 9, rlimit_nofile_soft: 8, rlimit_nofile_hard: 8, percent_of_soft_limit: 112.5 },
      ],
      total_processes_scanned: 200,
      highest_percent_of_limit: 600,
    };
    expect(alertsByType(s, "fd_exhaustion").length).toBe(0);
  });

  it("still fires on processes near the OS default (soft=1024)", () => {
    // Sanity: floor must not suppress real leaks at normal defaults.
    const s = healthySnapshot();
    s.process_fd = {
      available: true,
      top_consumers: [
        { pid: 1, comm: "real-leaker", fd_count: 900, rlimit_nofile_soft: 1024, rlimit_nofile_hard: 4096, percent_of_soft_limit: 87.9 },
      ],
      total_processes_scanned: 100,
      highest_percent_of_limit: 87.9,
    };
    const fired = alertsByType(s, "fd_exhaustion");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.scope).toBe("per_process");
  });

  it("falls back to host-wide only when process_fd absent (pre-v0.11.0 agent)", () => {
    const s = healthySnapshot();
    s.file_descriptors = { allocated: 850, free: 150, max: 1000, percent: 85 };
    // No process_fd field.
    const fired = alertsByType(s, "fd_exhaustion");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.scope).toBe("host_wide");
  });

  it("both paths emit when both signals are present", () => {
    const s = healthySnapshot();
    s.file_descriptors = { allocated: 850, free: 150, max: 1000, percent: 85 };
    s.process_fd = {
      available: true,
      top_consumers: [
        { pid: 1, comm: "leaker", fd_count: 980, rlimit_nofile_soft: 1024, rlimit_nofile_hard: 4096, percent_of_soft_limit: 95.7 },
      ],
      total_processes_scanned: 200,
      highest_percent_of_limit: 95.7,
    };
    const fired = alertsByType(s, "fd_exhaustion");
    expect(fired.length).toBe(2);
    const scopes = fired.map((f) => f.evidence.scope).sort();
    expect(scopes).toEqual(["host_wide", "per_process"]);
  });
});

// ============================================================================
// conntrack_exhaustion insert_failed signal
// ============================================================================

describe("conntrack_exhaustion insert_failed supplementary (C9)", () => {
  it("emits warning at moderate utilization when insert_failed_rate > 10/s", () => {
    const s = healthySnapshot();
    s.conntrack = {
      available: true,
      count: 50_000,
      max: 100_000,
      percent: 50,
      insert_failed_total: 1000,
      insert_failed_rate_per_sec: 25,
    };
    const fired = alertsByType(s, "conntrack_exhaustion");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect((fired[0].evidence as { note?: string }).note).toContain("table churn");
    expect(fired[0].evidence.insert_failed_rate_per_sec).toBe(25);
  });

  it("does NOT double-emit when utilization is already above 80%", () => {
    const s = healthySnapshot();
    s.conntrack = {
      available: true,
      count: 85_000,
      max: 100_000,
      percent: 85,
      insert_failed_total: 1000,
      insert_failed_rate_per_sec: 50,
    };
    const fired = alertsByType(s, "conntrack_exhaustion");
    expect(fired.length).toBe(1);
    // Single emission from the utilization path; carries insert_failed evidence.
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.insert_failed_rate_per_sec).toBe(50);
  });

  it("does not emit on low utilization + low insert_failed rate", () => {
    const s = healthySnapshot();
    s.conntrack = {
      available: true,
      count: 50_000,
      max: 100_000,
      percent: 50,
      insert_failed_total: 5,
      insert_failed_rate_per_sec: 0.1,
    };
    expect(alertsByType(s, "conntrack_exhaustion").length).toBe(0);
  });

  it("pre-0.11.0 agent (no insert_failed_rate field) still uses utilization path", () => {
    const s = healthySnapshot();
    s.conntrack = {
      available: true,
      count: 96_000,
      max: 100_000,
      percent: 96,
    };
    const fired = alertsByType(s, "conntrack_exhaustion");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });
});

// ============================================================================
// lacp_partner_lost (C8 new rule)
// ============================================================================

describe("lacp_partner_lost (C8)", () => {
  function bondSnap(
    bonds: NonNullable<Snapshot["bonding"]>["bonds"],
  ): Snapshot {
    const s = healthySnapshot();
    s.bonding = { available: true, bonds };
    return s;
  }

  it("emits critical when LACP partner unsynchronized on an MII-up slave", () => {
    const s = bondSnap([
      {
        name: "bond0",
        mode: "IEEE 802.3ad Dynamic link aggregation",
        is_lacp: true,
        lacp_rate: "fast",
        slaves: [
          {
            name: "eth0",
            mii_status: "up",
            link_failure_count: 0,
            permanent_hw_addr: "aa:bb:cc:dd:ee:f0",
            aggregator_id: 1,
            partner_churn_state: "churned",
            partner_lacp_port_state: 51,
            partner_lacp_synchronized: false,
          },
        ],
        configured_port_count: 1,
        active_aggregator: {
          id: 1,
          number_of_ports: 1,
          actor_key: 9,
          partner_key: 1,
          partner_mac_address: "11:22:33:44:55:66",
        },
      },
    ]);
    const fired = alertsByType(s, "lacp_partner_lost");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.bond_name).toBe("bond0");
    expect(fired[0].evidence.slave_name).toBe("eth0");
  });

  it("emits warning when active_aggregator number_of_ports < configured", () => {
    const s = bondSnap([
      {
        name: "bond0",
        mode: "IEEE 802.3ad Dynamic link aggregation",
        is_lacp: true,
        lacp_rate: "fast",
        slaves: [
          {
            name: "eth0",
            mii_status: "up",
            link_failure_count: 0,
            permanent_hw_addr: "x",
            aggregator_id: 1,
            partner_churn_state: "none",
            partner_lacp_port_state: 63,
            partner_lacp_synchronized: true,
          },
          {
            name: "eth1",
            mii_status: "up",
            link_failure_count: 0,
            permanent_hw_addr: "y",
            aggregator_id: 1,
            partner_churn_state: "none",
            partner_lacp_port_state: 63,
            partner_lacp_synchronized: true,
          },
        ],
        configured_port_count: 2,
        active_aggregator: { id: 1, number_of_ports: 1, actor_key: 9, partner_key: 1, partner_mac_address: "x" },
      },
    ]);
    const fired = alertsByType(s, "lacp_partner_lost");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.shortfall).toBe(1);
  });

  it("does not emit on non-LACP bonds", () => {
    const s = bondSnap([
      {
        name: "bond0",
        mode: "fault-tolerance (active-backup)",
        is_lacp: false,
        lacp_rate: null,
        slaves: [
          {
            name: "eth0",
            mii_status: "up",
            link_failure_count: 0,
            permanent_hw_addr: "x",
            aggregator_id: null,
            partner_churn_state: null,
            partner_lacp_port_state: null,
            partner_lacp_synchronized: null,
          },
        ],
        configured_port_count: 1,
        active_aggregator: null,
      },
    ]);
    expect(alertsByType(s, "lacp_partner_lost").length).toBe(0);
  });

  it("does not emit on slave with MII down (bond_slave_down territory)", () => {
    const s = bondSnap([
      {
        name: "bond0",
        mode: "IEEE 802.3ad Dynamic link aggregation",
        is_lacp: true,
        lacp_rate: "fast",
        slaves: [
          {
            name: "eth0",
            mii_status: "down",
            link_failure_count: 1,
            permanent_hw_addr: "x",
            aggregator_id: 1,
            partner_churn_state: "churned",
            partner_lacp_port_state: 0,
            partner_lacp_synchronized: false,
          },
        ],
        configured_port_count: 1,
        active_aggregator: null,
      },
    ]);
    expect(alertsByType(s, "lacp_partner_lost").length).toBe(0);
  });

  it("capability gate: no bonding field => no emission", () => {
    const s = healthySnapshot();
    expect(alertsByType(s, "lacp_partner_lost").length).toBe(0);
  });
});

// ============================================================================
// tcp_retrans_high (C10 new rule)
// ============================================================================

describe("tcp_retrans_high (C10)", () => {
  function tcpSnap(retrans_ratio: number | null): Snapshot {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 1_000_000,
      retrans_segs_total: 25_000,
      in_segs_total: 500_000,
      retrans_ratio,
      retrans_rate_per_sec: retrans_ratio !== null ? retrans_ratio * 10000 : null,
    };
    return s;
  }

  it("emits warning at ratio 0.025 (2.5%)", () => {
    const fired = alertsByType(tcpSnap(0.025), "tcp_retrans_high");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.retrans_ratio).toBe(0.025);
  });

  it("does not emit at ratio 0.01 (under threshold)", () => {
    expect(alertsByType(tcpSnap(0.01), "tcp_retrans_high").length).toBe(0);
  });

  it("does not emit on first snapshot (ratio null)", () => {
    expect(alertsByType(tcpSnap(null), "tcp_retrans_high").length).toBe(0);
  });

  it("capability gate: no tcp_stats => no emission", () => {
    const s = healthySnapshot();
    expect(alertsByType(s, "tcp_retrans_high").length).toBe(0);
  });

  // Low-traffic suppression (2026-05-22): high ratio + low absolute
  // retransmit rate = small-denominator noise on idle hosts; do not
  // fire. Empirically validated via iperf3 fleet test — idle val
  // hosts routinely hit 7-10% ratios from 1-4 retransmits in 60s.
  it("suppresses when retrans_rate_per_sec < 1.0 even at high ratio (small-denominator noise)", () => {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 50, // tiny denominator: idle host, 50 segs in 60s
      retrans_segs_total: 4,
      in_segs_total: 60,
      retrans_ratio: 0.08, // 8% — would have fired pre-fix
      retrans_rate_per_sec: 0.067, // 4 retrans / 60s
    };
    expect(alertsByType(s, "tcp_retrans_high").length).toBe(0);
  });

  it("still fires when out-segment volume is high and ratio is above threshold (real problem)", () => {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 100_000,
      retrans_segs_total: 5_000,
      in_segs_total: 100_000,
      retrans_ratio: 0.05, // 5%
      retrans_rate_per_sec: 30.0, // implied 30/0.05 = 600 segs/sec: real, high-traffic
    };
    const fired = alertsByType(s, "tcp_retrans_high");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.retrans_rate_per_sec).toBe(30.0);
  });

  it("suppresses when retrans_rate_per_sec is null (cannot evaluate gate)", () => {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 1000,
      retrans_segs_total: 50,
      in_segs_total: 1000,
      retrans_ratio: 0.05,
      retrans_rate_per_sec: null,
    };
    expect(alertsByType(s, "tcp_retrans_high").length).toBe(0);
  });

  // Volume gate (2026-06-07): the flat 1/sec retrans floor doesn't scale with
  // the ratio, so a quiet host (services: a few outbound API calls) firing at
  // a 20% ratio off ~7 segs/sec was still alerting. Require the implied
  // out-segment rate (retrans_rate / ratio) >= 50/sec.
  it("suppresses a high ratio at low segment volume even when rate >= 1/sec (services low-traffic pattern)", () => {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 5_000,
      retrans_segs_total: 1_000,
      in_segs_total: 5_000,
      retrans_ratio: 0.20, // 20% alarming-looking
      retrans_rate_per_sec: 1.5, // passes the old flat 1/sec floor...
      // ...but implied out-seg rate = 1.5 / 0.20 = 7.5 segs/sec << 500: noise.
    };
    expect(alertsByType(s, "tcp_retrans_high").length).toBe(0);
  });

  it("still fires a high ratio when the segment volume is genuinely high", () => {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 1_000_000,
      retrans_segs_total: 60_000,
      in_segs_total: 1_000_000,
      retrans_ratio: 0.06, // 6%
      retrans_rate_per_sec: 35.0, // implied 35/0.06 = 583 segs/sec >= 500: a real problem
    };
    expect(alertsByType(s, "tcp_retrans_high").length).toBe(1);
  });

  // Regression (2026-07-01): the production host baselines ~107 out-segs/sec (an
  // idle services box). A retransmit burst there produced 2-11% ratios that fired
  // under the old 50/sec floor. At ~107 segs/sec the ratio is not throughput-
  // relevant, so the raised 500/sec floor must suppress it.
  it("suppresses a quiet services box (~107 out-segs/sec) even at a high ratio", () => {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 1_000_000,
      retrans_segs_total: 50_000,
      in_segs_total: 1_000_000,
      retrans_ratio: 0.05, // 5%
      retrans_rate_per_sec: 5.35, // implied 5.35/0.05 = 107 segs/sec: quiet box, noise
    };
    expect(alertsByType(s, "tcp_retrans_high").length).toBe(0);
  });
});

// ============================================================================
// listen_overflow (C10 new rule)
// ============================================================================

describe("listen_overflow (C10)", () => {
  function tcpSnap(
    overflowsRate: number | null,
    dropsRate: number | null = 0,
  ): Snapshot {
    const s = healthySnapshot();
    s.tcp_stats = {
      available: true,
      out_segs_total: 1000,
      retrans_segs_total: 10,
      in_segs_total: 1000,
      retrans_ratio: 0.01,
      retrans_rate_per_sec: 0,
      listen_overflows_total: 500,
      listen_drops_total: 100,
      listen_overflows_rate_per_sec: overflowsRate,
      listen_drops_rate_per_sec: dropsRate,
    };
    return s;
  }

  it("emits warning on ANY non-zero ListenOverflows rate (overflows is the high-signal counter)", () => {
    const fired = alertsByType(tcpSnap(5.0), "listen_overflow");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.listen_overflows_rate_per_sec).toBe(5.0);
  });

  it("emits warning on a sustained ListenDrops rate (>= 1.0/s) even when overflows is zero", () => {
    const fired = alertsByType(tcpSnap(0, 3.0), "listen_overflow");
    expect(fired.length).toBe(1);
  });

  // 2026-05-23 noise-fix: drops counter is broader than overflows
  // (includes ENOMEM, long-tail SYN scans, brief OOM moments). Healthy
  // hosts see drops at very low rates. Without a minimum-rate gate the
  // rule pages "ListenDrops 0.00/s" (which is actually 0.0033/s rounded
  // by toFixed(2)) — mz62hd's val-asrock-x570d4u was doing this.
  it("does NOT emit on ListenDrops 0.0033/s with overflows zero (mz62hd noise pattern)", () => {
    const fired = alertsByType(tcpSnap(0, 0.0033), "listen_overflow");
    expect(fired.length).toBe(0);
  });

  // 2026-06-07 low-traffic raise: drops floor went 0.1/s -> 1.0/s. The services
  // host was paging on 0.12-0.18/s of long-tail drops with overflows = 0.
  it("does NOT emit on ListenDrops 0.18/s with overflows zero (services noise; below the 1.0/s floor)", () => {
    const fired = alertsByType(tcpSnap(0, 0.18), "listen_overflow");
    expect(fired.length).toBe(0);
  });

  it("DOES emit on ListenDrops at the 1.0/s boundary with overflows zero", () => {
    const fired = alertsByType(tcpSnap(0, 1.0), "listen_overflow");
    expect(fired.length).toBe(1);
  });

  it("DOES emit on ListenOverflows at 0.01/s even when drops is below floor", () => {
    // Overflows has a stricter kernel meaning (accept queue full); any
    // non-zero rate is signal. Drops floor doesn't gate overflows.
    const fired = alertsByType(tcpSnap(0.01, 0.0033), "listen_overflow");
    expect(fired.length).toBe(1);
  });

  it("does not emit when both rates are zero (steady state)", () => {
    expect(alertsByType(tcpSnap(0, 0), "listen_overflow").length).toBe(0);
  });

  it("does not emit on first snapshot (rates null)", () => {
    expect(alertsByType(tcpSnap(null, null), "listen_overflow").length).toBe(0);
  });

  it("capability gate: no tcp_stats => no emission", () => {
    const s = healthySnapshot();
    expect(alertsByType(s, "listen_overflow").length).toBe(0);
  });
});
