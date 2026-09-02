// Server reachability watchdog.
//
// Crucible is agent-based: if the server is down, the agent is down, and Dashboard
// stops hearing from it. This module runs server-side on a schedule and fires
// P1 `server_unreachable` alerts for servers that have stopped reporting.
//
// Pure decision function (`findStaleServers`) is separate from the DB wiring
// (`runWatchdogCycle`) so it can be unit-tested without a database.

import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { dispatchNotifications } from "./alerts/dispatcher";

export interface WatchedServer {
  id: string;
  name: string;
  hostname: string | null;
  ip: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  /** Operator-set interval override (config_overrides.interval_seconds); null when unset. */
  config_interval_seconds: number | null;
  /** Ingest-measured gap between the two most recent snapshots (migration
   *  028); null until two snapshots have arrived. The agent never reports
   *  its configured interval, so this is the only cadence signal for the
   *  (typical) servers with no operator override. */
  observed_interval_seconds: number | null;
}

/** Effective cadence: operator override wins, else the measured cadence,
 *  else the 300s default. `||` (not `??`) so a zero/garbage value falls
 *  through instead of producing a 0s threshold. */
export function effectiveIntervalSeconds(server: WatchedServer): number {
  return server.config_interval_seconds || server.observed_interval_seconds || DEFAULT_INTERVAL_SECONDS;
}

export interface StaleServer {
  server: WatchedServer;
  /** Epoch ms of the last snapshot, or null when the server has NEVER reported. */
  lastSeenMs: number | null;
  /** Minutes since the last snapshot, or (for a never-reported server) minutes
   *  since it was enrolled. */
  minutesSinceLastSeen: number;
  /** True when the server was enrolled but has never sent a single snapshot
   *  (the agent probably failed to install/start) rather than having reported
   *  and then gone quiet. Grok H-D4a: these used to stay 'active' with zero
   *  alerts forever ("ghost tiles"). */
  neverReported: boolean;
}

// Constants mirror the Crucible default collection interval (5 minutes).
export const DEFAULT_INTERVAL_SECONDS = 300;
// Servers younger than this never fire the alert, to absorb install/onboarding.
export const MIN_SERVER_AGE_MS = 10 * 60 * 1000;
// A server that has NEVER reported gets a longer grace than a reported-then-quiet
// one: a first install (Node bootstrap, package fetch, first snapshot) can take a
// few minutes, and we only want to flag a genuine install failure, not a slow
// bootstrap. Grok H-D4a.
export const NEVER_REPORTED_GRACE_MS = 20 * 60 * 1000;

export function findStaleServers(servers: WatchedServer[], nowMs: number): StaleServer[] {
  const stale: StaleServer[] = [];
  for (const server of servers) {
    const ageMs = nowMs - server.created_at.getTime();

    // Never-reported servers: previously skipped entirely, which left a failed
    // install as a permanently green "active" tile with no alert. Fire a
    // distinct never-reported signal once past a generous install grace.
    if (!server.last_seen_at) {
      if (ageMs < NEVER_REPORTED_GRACE_MS) continue;
      stale.push({
        server,
        lastSeenMs: null,
        minutesSinceLastSeen: Math.floor(ageMs / 60_000),
        neverReported: true,
      });
      continue;
    }

    // Onboarding grace period for reported-then-quiet servers.
    if (ageMs < MIN_SERVER_AGE_MS) continue;

    const lastSeenMs = server.last_seen_at.getTime();
    const thresholdMs = 2 * effectiveIntervalSeconds(server) * 1000;
    const sinceLast = nowMs - lastSeenMs;
    if (sinceLast < thresholdMs) continue;

    stale.push({
      server,
      lastSeenMs,
      minutesSinceLastSeen: Math.floor(sinceLast / 60_000),
      neverReported: false,
    });
  }
  return stale;
}

export function buildFixCommands(server: WatchedServer): string[] {
  const target = server.ip || server.hostname || "<server>";
  return [
    "# Check if the server is reachable at the network level",
    `ping -c 3 ${target}`,
    "",
    "# If reachable, check the Crucible collector",
    `ssh ${target} sudo systemctl status glassmkr-crucible`,
    `ssh ${target} sudo journalctl -u glassmkr-crucible -n 20 --no-pager`,
    "",
    "# If not reachable, open the hosting panel for IPMI or KVM access",
  ];
}

export function buildUnreachableAlertTitle(minutes: number): string {
  return `Server has not reported in ${minutes} minutes`;
}

export function buildUnreachableAlertMessage(server: WatchedServer, lastSeenMs: number): string {
  const lastSeenIso = new Date(lastSeenMs).toISOString();
  return `Last snapshot received at ${lastSeenIso}. The server may be down, rebooting, or Crucible may have stopped.`;
}

// Never-reported ("ghost tile") variant. Grok H-D4a: an enrolled server whose
// agent never installed/started used to show as a permanently green tile with no
// alert. These builders drive a server_unreachable alert with install-focused
// copy so the failure is visible and actionable.
export function buildNeverReportedAlertTitle(minutes: number): string {
  return `Server has never reported (enrolled ${minutes} minutes ago)`;
}

export function buildNeverReportedAlertMessage(_server: WatchedServer): string {
  return "This server was enrolled but has never sent a snapshot. The Crucible agent most likely failed to install or start (an install.sh error, Node/glibc too old for the agent, a restrictive umask, or a rejected collector key). It will not appear healthy until the agent runs.";
}

export function buildNeverReportedFixCommands(server: WatchedServer): string[] {
  const target = server.ip || server.hostname || "<server>";
  return [
    "# Enrolled but never checked in: the agent most likely failed to install",
    "# or start. On the host, inspect the collector:",
    `ssh ${target} sudo systemctl status glassmkr-crucible`,
    `ssh ${target} sudo journalctl -u glassmkr-crucible -n 50 --no-pager`,
    "",
    "# Common causes: install.sh failed (Node/glibc too old, or no supported",
    "# package manager), a restrictive umask left the package unreadable, or the",
    "# collector key was rejected. Re-run the installer with the collector key:",
    "# curl -sf https://glassmkr.com/install.sh | sudo bash -s -- --api-key <key>",
  ];
}

// DB wiring. Called every two minutes by the scheduler. Silent on no-op cycles.
export async function runWatchdogCycle(nowMs: number = Date.now()): Promise<void> {
  const res = await query(
    `SELECT s.id, s.name, s.hostname, s.ip, s.last_seen_at, s.created_at, s.config_overrides,
            s.observed_interval_seconds
     FROM servers s
     WHERE s.status = 'active'
       -- Exclude the read-only demo tenant: its servers are seeded with
       -- static snapshots and never ingest, so the watchdog would
       -- otherwise fire server_unreachable on every one of them.
       AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = s.customer_id AND c.is_demo)`
  );

  const watched: WatchedServer[] = res.rows.map((r: Record<string, unknown>) => {
    const cfg = (r.config_overrides as { interval_seconds?: number } | null)?.interval_seconds;
    return {
      id: r.id as string,
      name: r.name as string,
      hostname: (r.hostname as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
      last_seen_at: (r.last_seen_at as Date | null) ?? null,
      created_at: r.created_at as Date,
      config_interval_seconds: cfg == null ? null : Number(cfg),
      observed_interval_seconds:
        r.observed_interval_seconds == null ? null : Number(r.observed_interval_seconds),
    };
  });

  const stale = findStaleServers(watched, nowMs);
  if (stale.length === 0) return;

  for (const { server, lastSeenMs, minutesSinceLastSeen, neverReported } of stale) {
    const title = neverReported
      ? buildNeverReportedAlertTitle(minutesSinceLastSeen)
      : buildUnreachableAlertTitle(minutesSinceLastSeen);
    const message = neverReported
      ? buildNeverReportedAlertMessage(server)
      : buildUnreachableAlertMessage(server, lastSeenMs!);
    const evidence = {
      server_id: server.id,
      never_reported: neverReported,
      last_seen_iso: lastSeenMs != null ? new Date(lastSeenMs).toISOString() : null,
      minutes_since_last_seen: minutesSinceLastSeen,
      interval_seconds: effectiveIntervalSeconds(server),
      fix_commands: neverReported ? buildNeverReportedFixCommands(server) : buildFixCommands(server),
    };
    const recommendation = neverReported
      ? "This node was enrolled but the agent has never checked in, so the install most likely failed. Inspect the collector on the host (`systemctl status glassmkr-crucible`, `journalctl -u glassmkr-crucible`) and re-run the installer if needed. This alert auto-resolves once the agent sends its first snapshot."
      : "Reachable servers with the collector stopped can be restarted with `sudo systemctl restart glassmkr-crucible`. Unreachable servers require hosting-panel intervention (IPMI, KVM, or remote reboot). This alert auto-resolves when the server sends its next snapshot.";

    const upsert = await query(
      `INSERT INTO active_alerts (server_id, alert_type, severity, title, message, evidence, recommendation, first_seen, last_seen)
       VALUES ($1, 'server_unreachable', 'critical', $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (server_id, alert_type) WHERE resolved_at IS NULL
       DO UPDATE SET severity = 'critical', title = $2, message = $3, evidence = $4, recommendation = $5,
                     last_seen = NOW()
       RETURNING (xmax = 0) AS is_new`,
      [server.id, title, message, JSON.stringify(evidence), recommendation]
    );
    const isNew = upsert.rows[0]?.is_new;

    // Only log once per new fire; updated rows on every 2-minute cycle would be noise.
    if (isNew) {
      console.log(
        neverReported
          ? `[watchdog] Server never reported: ${server.name} (${server.id}), enrolled ${minutesSinceLastSeen}m ago`
          : `[watchdog] Server unreachable: ${server.name} (${server.id}), last seen ${minutesSinceLastSeen}m ago`,
      );
    }

    // Append to alert_history on every cycle where the alert is first fired.
    if (isNew) {
      try {
        await clickhouse.insert({
          table: "alert_history",
          values: [{
            server_id: server.id,
            timestamp: Date.now(),
            event_type: "fired",
            alert_type: "server_unreachable",
            severity: "critical",
            title,
            message,
            evidence: JSON.stringify(evidence),
            recommendation,
          }],
          format: "JSONEachRow",
        });
      } catch (err) {
        console.error("[watchdog] alert_history insert error:", (err as Error).message);
      }
    }
  }

  // Dispatch notifications for any unsent server_unreachable rows.
  // Group by server_id and send per server so dispatcher can load its channels.
  const unsent = await query(
    `SELECT id, server_id, alert_type, severity, title, message, evidence, recommendation
     FROM active_alerts
     WHERE alert_type = 'server_unreachable' AND notification_sent = FALSE AND resolved_at IS NULL`
  );
  const byServer = new Map<string, typeof unsent.rows>();
  for (const row of unsent.rows) {
    const arr = byServer.get(row.server_id as string) ?? [];
    arr.push(row);
    byServer.set(row.server_id as string, arr);
  }
  for (const [serverId, rows] of byServer) {
    dispatchNotifications(serverId, rows, []).catch((err: unknown) =>
      console.error("[watchdog] dispatch error:", (err as Error).message)
    );
  }
}
