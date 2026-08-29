import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { READ_QUERY_SETTINGS } from "$lib/server/query-ceilings";
import {
  HOST_PROFILES,
  suggestMarketplaceProfile,
} from "$lib/server/alerts/host-profiles";

export interface ListServersOptions {
  customerId: string;
  limit: number;
  createdBefore?: Date | null;
  cursor?: { createdAt: Date; serverId: string } | null;
  tags?: string[];
}

export interface ServerListResult {
  servers: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextCreatedAt: Date | null;
  nextServerId: string | null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSnapshotFields(snapshot: Record<string, unknown>): void {
  for (const field of [
    "disks",
    "smart",
    "network",
    "raid",
    "ipmi",
    "cpu_cores",
    "security",
    "gpu",
    "thermal",
    "memory_topology",
  ]) {
    const value = snapshot[field];
    if (typeof value !== "string") continue;
    try {
      snapshot[field] = JSON.parse(value);
    } catch {
      // Older collectors may have stored a non-JSON string. Preserve it as data.
    }
  }
}

export async function listServersForCustomer(
  options: ListServersOptions,
): Promise<ServerListResult> {
  const limit = Math.max(1, Math.min(options.limit, 100));
  const params: unknown[] = [options.customerId];
  let where = "s.customer_id = $1 AND s.status != 'deleted'";

  if (options.cursor) {
    params.push(options.cursor.createdAt, options.cursor.serverId);
    where += ` AND (s.created_at, s.id) < ($${params.length - 1}, $${params.length})`;
  } else if (options.createdBefore) {
    params.push(options.createdBefore);
    where += ` AND s.created_at < $${params.length}`;
  }
  if (options.tags && options.tags.length > 0) {
    params.push(options.tags);
    where += ` AND s.tags && $${params.length}::text[]`;
  }
  params.push(limit + 1);

  const result = await query(
    `SELECT s.id, s.name, s.hostname, s.ip, s.os_type, s.os_version,
            s.status, s.suspended_at, s.suspended_reason,
            s.last_seen_at, s.collector_version, s.created_at,
            s.tags, s.profile,
            s.dmi_vendor, s.dmi_product, s.ipmi_sensors_count, s.gpu_count,
            (SELECT COUNT(*) FROM active_alerts a
               WHERE a.server_id = s.id AND a.resolved_at IS NULL) AS active_alerts,
            (SELECT state FROM disk_health_state dhs
               WHERE dhs.server_id = s.id
               ORDER BY CASE state
                 WHEN 'broken'    THEN 3
                 WHEN 'failing'   THEN 2
                 WHEN 'declining' THEN 1
                 ELSE 0 END DESC
               LIMIT 1) AS disk_health_rollup
       FROM servers s
      WHERE ${where}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${params.length}`,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const servers = rows.map((server: Record<string, unknown>) => ({
    id: server.id,
    name: server.name,
    hostname: server.hostname,
    ip: server.ip,
    os_type: server.os_type,
    os_version: server.os_version,
    status: server.status,
    suspended_at: server.suspended_at,
    suspended_reason: server.suspended_reason,
    last_seen_at: server.last_seen_at,
    collector_version: server.collector_version,
    active_alerts: asNumber(server.active_alerts),
    disk_health_rollup: server.disk_health_rollup ?? "healthy",
    created_at: server.created_at,
    tags: Array.isArray(server.tags) ? server.tags : [],
    profile: server.profile ?? null,
    dmi_vendor: server.dmi_vendor ?? null,
    dmi_product: server.dmi_product ?? null,
    ipmi_sensors_count: asNumber(server.ipmi_sensors_count),
    gpu_count: asNumber(server.gpu_count),
  }));

  const lastCreatedAt = rows.at(-1)?.created_at;
  const lastServerId = rows.at(-1)?.id;
  return {
    servers,
    hasMore,
    nextCreatedAt:
      hasMore && lastCreatedAt ? new Date(lastCreatedAt as string | number | Date) : null,
    nextServerId: hasMore && typeof lastServerId === "string" ? lastServerId : null,
  };
}

export async function getServerForCustomer(
  customerId: string,
  serverId: string,
  options?: { includeDeleted?: boolean },
): Promise<Record<string, unknown> | null> {
  // The management-plane HTTP route (GET /api/v1/servers/[id]) must still return
  // soft-deleted servers so the trash/restore UI can render one: it passes
  // includeDeleted. MCP omits deleted servers (they are absent from list_servers
  // too), so servers.get uses the default and 404s a trashed server.
  const deletedFilter = options?.includeDeleted ? "" : " AND s.status != 'deleted'";
  const result = await query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM active_alerts a
              WHERE a.server_id = s.id AND a.resolved_at IS NULL) AS active_alerts
       FROM servers s
      WHERE s.id = $1 AND s.customer_id = $2${deletedFilter}`,
    [serverId, customerId],
  );
  const server = result.rows[0] as Record<string, unknown> | undefined;
  if (!server) return null;

  const tags = Array.isArray(server.tags) ? (server.tags as string[]) : [];
  const profile = typeof server.profile === "string" ? server.profile : null;
  return {
    id: server.id,
    name: server.name,
    hostname: server.hostname,
    ip: server.ip,
    os_type: server.os_type,
    os_version: server.os_version,
    status: server.status,
    suspended_at: server.suspended_at,
    suspended_reason: server.suspended_reason,
    last_seen_at: server.last_seen_at,
    collector_version: server.collector_version,
    config_overrides: server.config_overrides,
    free_analysis_used: Boolean(server.free_analysis_used),
    active_alerts: asNumber(server.active_alerts),
    created_at: server.created_at,
    tags,
    profile,
    suggested_profile: suggestMarketplaceProfile(tags, profile),
    dmi_vendor: server.dmi_vendor ?? null,
    dmi_product: server.dmi_product ?? null,
    ipmi_sensors_count: asNumber(server.ipmi_sensors_count),
  };
}


export async function getServerHealthForCustomer(
  customerId: string,
  serverId: string,
): Promise<Record<string, unknown> | null> {
  const serverResult = await query(
    `SELECT id, name, hostname, ip
       FROM servers
      WHERE id = $1 AND customer_id = $2 AND status != 'deleted'`,
    [serverId, customerId],
  );
  if (serverResult.rows.length === 0) return null;

  const snapshotResult = await clickhouse.query({
    query: `
      SELECT *
      FROM snapshots
      WHERE server_id = {server_id:String}
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    query_params: { server_id: serverId },
    format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
  });
  const snapshotRows: Record<string, unknown>[] = await snapshotResult.json();
  const snapshot = snapshotRows[0] ?? null;
  if (snapshot) parseSnapshotFields(snapshot);

  const alertsResult = await query(
    `SELECT id, alert_type, severity, title, message, evidence, recommendation,
            first_seen, last_seen, acknowledged, acknowledged_at
       FROM active_alerts
      WHERE server_id = $1 AND resolved_at IS NULL
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        first_seen DESC`,
    [serverId],
  );

  return {
    server: serverResult.rows[0],
    snapshot,
    alerts: alertsResult.rows,
    freshness: freshnessOf(snapshot),
  };
}

/**
 * How old the data in this response is, stated rather than implied.
 *
 * A caller handed a snapshot has no way to tell whether it arrived a minute ago
 * or a day ago, and the two support opposite decisions. That is tolerable for a
 * human looking at a dashboard that also shows "last seen"; it is not tolerable
 * for an agent, which will otherwise act on a stale reading as though it were
 * current. The demo made the same mistake visually for months, showing hosts
 * last seen twenty hours earlier under a "LIVE" label.
 *
 * `stale` uses the same fifteen-minute threshold the fleet table uses, which is
 * three missed collections at the five-minute cadence: one missed collection is
 * noise, three is a host that has stopped talking.
 */
const STALE_AFTER_SECONDS = 15 * 60;

function freshnessOf(snapshot: Record<string, unknown> | null): {
  observed_at: string | null;
  age_seconds: number | null;
  stale: boolean;
  stale_after_seconds: number;
} {
  const raw = snapshot?.timestamp;
  const observedAt = raw ? new Date(String(raw).endsWith("Z") ? String(raw) : `${raw}Z`) : null;
  // ClickHouse returns naive timestamps with no zone. Reading one with
  // `new Date()` on a machine that is not UTC invents an offset and fabricates
  // hours of staleness, which is a real bug this project has already shipped
  // once; appending the Z is what stops it recurring here.
  if (!observedAt || Number.isNaN(observedAt.getTime())) {
    return { observed_at: null, age_seconds: null, stale: true, stale_after_seconds: STALE_AFTER_SECONDS };
  }
  const age = Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 1000));
  return {
    observed_at: observedAt.toISOString(),
    age_seconds: age,
    stale: age > STALE_AFTER_SECONDS,
    stale_after_seconds: STALE_AFTER_SECONDS,
  };
}

export async function getServerHistoryForCustomer(
  customerId: string,
  serverId: string,
  hours: number,
  bucketMinutes?: 5 | 30 | 60 | 180,
): Promise<{ hours: number; interval_minutes: number; data: unknown[] } | null> {
  const owned = await query(
    `SELECT id FROM servers
      WHERE id = $1 AND customer_id = $2 AND status != 'deleted'`,
    [serverId, customerId],
  );
  if (owned.rows.length === 0) return null;

  const boundedHours = Math.max(1, Math.min(Math.trunc(hours), 720));
  // 5-minute buckets only up to 144h: 168h at 5-minute buckets is 2016 rows,
  // which trips the MCP result cap (MAX_ARRAY_ITEMS=2000) as OUTPUT_TOO_LARGE.
  // 144h/5min = 1728 rows (safe); 145..720h fall to 30-minute buckets (<= 1440
  // rows). Callers may still pass bucketMinutes explicitly to override.
  const intervalMinutes = bucketMinutes ?? (boundedHours <= 144 ? 5 : 30);
  const historyResult = await clickhouse.query({
    query: `
      SELECT
        toStartOfInterval(timestamp, toIntervalMinute({interval_minutes:UInt32})) AS ts,
        avg(cpu_user_percent) AS cpu_user,
        avg(cpu_system_percent) AS cpu_system,
        avg(cpu_iowait_percent) AS cpu_iowait,
        avg(ram_used_mb) AS ram_used,
        max(ram_total_mb) AS ram_total,
        avg(swap_used_mb) AS swap_used,
        avg(load_1m) AS load_1m
      FROM snapshots
      WHERE server_id = {server_id:String}
        AND timestamp > now() - INTERVAL {hours:UInt32} HOUR
      GROUP BY ts
      ORDER BY ts ASC
    `,
    query_params: {
      server_id: serverId,
      hours: boundedHours,
      interval_minutes: intervalMinutes,
    },
    format: "JSONEachRow",
      clickhouse_settings: READ_QUERY_SETTINGS,
  });
  const data: unknown[] = await historyResult.json();
  return { hours: boundedHours, interval_minutes: intervalMinutes, data };
}

export async function getFleetSummaryForCustomer(
  customerId: string,
): Promise<Record<string, unknown>> {
  const result = await query(
    `WITH owned_servers AS (
       SELECT id, status, last_seen_at
         FROM servers
        WHERE customer_id = $1 AND status != 'deleted'
     )
     SELECT COUNT(*) FILTER (
              WHERE s.status = 'active'
                AND s.last_seen_at >= NOW() - INTERVAL '15 minutes'
            ) AS active,
            COUNT(*) FILTER (
              WHERE s.status = 'active'
                AND (s.last_seen_at IS NULL OR s.last_seen_at < NOW() - INTERVAL '15 minutes')
            ) AS offline,
            COUNT(*) FILTER (WHERE s.status = 'suspended') AS suspended,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE s.last_seen_at >= NOW() - INTERVAL '15 minutes') AS seen_last_15m,
            MIN(s.last_seen_at) AS oldest_last_seen_at,
            MAX(s.last_seen_at) AS newest_last_seen_at,
            (SELECT COUNT(*)
               FROM active_alerts a
               JOIN owned_servers owned ON owned.id = a.server_id
              WHERE a.resolved_at IS NULL) AS active_alerts
       FROM owned_servers s`,
    [customerId],
  );
  const row = result.rows[0] as Record<string, unknown>;
  return {
    servers: {
      total: asNumber(row.total),
      active: asNumber(row.active),
      offline: asNumber(row.offline),
      suspended: asNumber(row.suspended),
      seen_last_15m: asNumber(row.seen_last_15m),
    },
    active_alerts: asNumber(row.active_alerts),
    oldest_last_seen_at: row.oldest_last_seen_at ?? null,
    newest_last_seen_at: row.newest_last_seen_at ?? null,
  };
}

export function listHostProfiles(): Array<Record<string, unknown>> {
  return Object.values(HOST_PROFILES).map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.description,
    suppressed_rules: profile.suppressed_rules,
  }));
}
