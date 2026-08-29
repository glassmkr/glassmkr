import { createClient } from "@clickhouse/client";

// Credentials are optional so an existing deployment that runs ClickHouse
// without authentication keeps working untouched: absent env vars fall back to
// the historical "default user, no password" behaviour. The bundled
// self-hosting stack DOES set them, because current ClickHouse images lock the
// default account and a cross-container client cannot authenticate without
// them (found by the first clean-machine compose run, 2026-08-25).
export const clickhouse = createClient({
  url: `http://${process.env.CLICKHOUSE_HOST || "localhost"}:${process.env.CLICKHOUSE_PORT || "8123"}`,
  database: process.env.CLICKHOUSE_DATABASE || "glassmkr",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
});

/**
 * Cleanly closes the ClickHouse client. Called from graceful-shutdown
 * handlers on SIGTERM/SIGINT alongside `closePool()`.
 *
 * Idempotent: the underlying client tolerates being closed multiple
 * times. Errors are swallowed (and logged) to keep shutdown
 * deterministic.
 */
export async function closeClickhouse(): Promise<void> {
  try {
    await clickhouse.close();
  } catch (err) {
    console.error("[shutdown] clickhouse.close() failed:", (err as Error).message);
  }
}
