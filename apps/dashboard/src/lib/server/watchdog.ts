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
  lastSeenMs: number;
  minutesSinceLastSeen: number;
}

// Constants mirror the Crucible default collection interval (5 minutes).
export const DEFAULT_INTERVAL_SECONDS = 300;
// Servers younger than this never fire the alert, to absorb install/onboarding.
export const MIN_SERVER_AGE_MS = 10 * 60 * 1000;

export function findStaleServers(servers: WatchedServer[], nowMs: number): StaleServer[] {
  const stale: StaleServer[] = [];
  for (const server of servers) {
    // Never-reported servers: do not fire. Customer may still be installing.
    if (!server.last_seen_at) continue;
    // Onboarding grace period.
    if (nowMs - server.created_at.getTime() < MIN_SERVER_AGE_MS) continue;

    const lastSeenMs = server.last_seen_at.getTime();
    const thresholdMs = 2 * effectiveIntervalSeconds(server) * 1000;
    const sinceLast = nowMs - lastSeenMs;
    if (sinceLast < thresholdMs) continue;

    stale.push({
      server,
      lastSeenMs,
      minutesSinceLastSeen: Math.floor(sinceLast / 60_000),
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

  for (const { server, lastSeenMs, minutesSinceLastSeen } of stale) {
    const title = buildUnreachableAlertTitle(minutesSinceLastSeen);
    const message = buildUnreachableAlertMessage(server, lastSeenMs);
    const evidence = {
      server_id: server.id,
      last_seen_iso: new Date(lastSeenMs).toISOString(),
      minutes_since_last_seen: minutesSinceLastSeen,
      interval_seconds: effectiveIntervalSeconds(server),
      fix_commands: buildFixCommands(server),
    };
    const recommendation = "Reachable servers with the collector stopped can be restarted with `sudo systemctl restart glassmkr-crucible`. Unreachable servers require hosting-panel intervention (IPMI, KVM, or remote reboot). This alert auto-resolves when the server sends its next snapshot.";

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
      console.log(`[watchdog] Server unreachable: ${server.name} (${server.id}), last seen ${minutesSinceLastSeen}m ago`);
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
