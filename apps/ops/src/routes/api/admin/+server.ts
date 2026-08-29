import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db";

// Lazy import clickhouse only when needed (may not be available in all envs)
async function getClickhouse() {
  try {
    const mod = await import("@glassmkr/db/clickhouse");
    return mod.clickhouse;
  } catch {
    return null;
  }
}

async function getOverview() {
  const [customers, servers, alerts] = await Promise.all([
    query("SELECT COUNT(*) FROM customers"),
    query("SELECT COUNT(*) FROM servers WHERE status = 'active'"),
    query("SELECT COUNT(*) FROM active_alerts WHERE resolved_at IS NULL"),
  ]);

  let snapshotsLastHour = 0;
  const ch = await getClickhouse();
  if (ch) {
    try {
      const snapResult = await ch.query({
        query:
          "SELECT count() as cnt FROM snapshots WHERE timestamp > now() - INTERVAL 1 HOUR",
        format: "JSONEachRow",
      });
      const snapRows: any[] = await snapResult.json();
      snapshotsLastHour = snapRows[0]?.cnt || 0;
    } catch {
      // ClickHouse not available; leave at 0
    }
  }

  return {
    customers: parseInt(customers.rows[0].count),
    servers: parseInt(servers.rows[0].count),
    active_alerts: parseInt(alerts.rows[0].count),
    snapshots_last_hour: snapshotsLastHour,
  };
}

async function getCustomers() {
  const result = await query(`
    SELECT c.id, c.email, c.status, c.plan, c.plan_server_limit, c.created_at,
      (SELECT COUNT(*) FROM servers s WHERE s.customer_id = c.id AND s.status = 'active') as server_count,
      (SELECT COUNT(*) FROM active_alerts a JOIN servers s ON a.server_id = s.id WHERE s.customer_id = c.id AND a.resolved_at IS NULL) as alert_count
    FROM customers c ORDER BY c.created_at DESC
  `);
  return { customers: result.rows };
}

async function getServers() {
  const result = await query(`
    SELECT s.*, c.email as customer_email,
      (SELECT COUNT(*) FROM active_alerts a WHERE a.server_id = s.id AND a.resolved_at IS NULL) as alert_count
    FROM servers s
    JOIN customers c ON s.customer_id = c.id
    WHERE s.status = 'active'
    ORDER BY s.last_seen_at DESC NULLS LAST
  `);
  return { servers: result.rows };
}

async function getAlerts() {
  const result = await query(`
    SELECT a.*, s.name as server_name, s.ip as server_ip, c.email as customer_email
    FROM active_alerts a
    JOIN servers s ON a.server_id = s.id
    JOIN customers c ON s.customer_id = c.id
    WHERE a.resolved_at IS NULL
    ORDER BY
      CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      a.first_seen DESC
    LIMIT 100
  `);
  return { alerts: result.rows };
}

async function getSystem() {
  // ClickHouse stats
  let tables: any[] = [];
  const ch = await getClickhouse();
  if (ch) {
    try {
      const chStats = await ch.query({
        query: `
          SELECT table, formatReadableSize(sum(data_compressed_bytes)) as compressed,
                 formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed,
                 round(sum(data_uncompressed_bytes) / greatest(sum(data_compressed_bytes), 1), 2) as ratio,
                 sum(rows) as total_rows
          FROM system.parts WHERE database = 'glassmkr' AND active GROUP BY table
        `,
        format: "JSONEachRow",
      });
      tables = await chStats.json();
    } catch {
      // ClickHouse not available
    }
  }

  // PostgreSQL connection count
  const pgConns = await query(
    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
  );

  return {
    clickhouse: { tables },
    postgres: { connections: parseInt(pgConns.rows[0].count) },
  };
}

// Defence-in-depth for ops. `hooks.server.ts` verifies the
// `cf-access-jwt-assertion` JWT against Cloudflare's JWKS and the
// configured AUD, and stashes the verified email on `locals.email`. We
// then check that email against the admin allow-list. We never read the
// raw `cf-access-authenticated-user-email` header here, because it is
// attacker-controlled on any request that can reach the Node service
// directly (private VPN, misconfigured CF rule, etc).
const ADMIN_EMAILS = (process.env.OPS_ADMIN_EMAILS ?? "simon@glassmkr.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function requireOpsAdmin(locals: App.Locals, headers: Headers): string {
  const email = locals.email;
  if (email && ADMIN_EMAILS.includes(email)) return email;
  // Local-dev bypass: shared bearer secret so the ops UI still works
  // without CF Access. Never set in production.
  const devBearer = process.env.OPS_ADMIN_DEV_SECRET;
  const auth = headers.get("authorization");
  if (devBearer && auth === `Bearer ${devBearer}`) return "dev-bearer";
  throw new Response(null, { status: 401 });
}

export const GET: RequestHandler = async ({ url, request, locals }) => {
  try {
    requireOpsAdmin(locals, request.headers);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const tab = url.searchParams.get("tab") || "overview";

  try {
    let data: any;
    switch (tab) {
      case "overview":
        data = await getOverview();
        break;
      case "customers":
        data = await getCustomers();
        break;
      case "servers":
        data = await getServers();
        break;
      case "alerts":
        data = await getAlerts();
        break;
      case "system":
        data = await getSystem();
        break;
      default:
        return json({ error: "Unknown tab" }, { status: 400 });
    }
    return json(data);
  } catch (err: any) {
    console.error(`[ops] admin/${tab} error:`, err);
    return json({ error: err.message }, { status: 500 });
  }
};
