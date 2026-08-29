import pg from "pg";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      // Default `dashboard` matches the post-rename DB name (Spec 1, 2026-05-16).
      // Production always has DB_NAME set explicitly via /etc/glassmkr/dashboard.env;
      // this default only matters for dev/test environments that forget to set it.
      database: process.env.DB_NAME || "dashboard",
      user: process.env.DB_USER || "agent",
      password: process.env.DB_PASSWORD || "",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (err) => {
      console.error("Unexpected database pool error:", err);
    });
  }
  return pool;
}

export async function query(text: string, params?: any[]) {
  return getPool().query(text, params);
}

export async function getClient() {
  return getPool().connect();
}

export type TxClient = pg.PoolClient;

export async function withTransaction<T>(
  fn: (client: TxClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let result: T;
    try {
      result = await fn(client);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
    await client.query("COMMIT");
    return result;
  } finally {
    client.release();
  }
}

/**
 * Cleanly drains and ends the PG pool. Called from graceful-shutdown
 * handlers on SIGTERM/SIGINT so the process exits without leaving
 * orphan PG connections that systemd would later have to SIGKILL.
 *
 * Idempotent: calling twice is safe (second call sees `pool === null`).
 * The promise resolves once all in-flight queries finish and pool
 * sockets close, or when `pool.end()` rejects (we swallow the rejection
 * to keep shutdown deterministic; logged for triage).
 */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  try {
    await p.end();
  } catch (err) {
    console.error("[shutdown] pg pool.end() failed:", (err as Error).message);
  }
}

export default getPool;
