// Graceful shutdown handler for the dashboard process.
//
// Context: retrospective F1 (CC_SPEC_4 / 2026-05-15 rename cutover).
// On `systemctl stop glassmkr-forge` the old binary ignored SIGTERM
// for the full 30s `TimeoutStopSec` before systemd sent SIGKILL.
// User-visible impact was ~1s downtime; the deeper issue was no
// app-level cleanup, so PG/ClickHouse/Redis sockets were dropped
// uncleanly rather than ended gracefully.
//
// @sveltejs/adapter-node already registers its own SIGTERM/SIGINT
// handlers that close the internal HTTP server. This module ADDS
// app-level handlers that:
//   1. Mark shutdown in-progress (idempotent on a second signal).
//   2. End the PG pool, ClickHouse client, and Redis client in
//      parallel so the process can exit cleanly.
//   3. Cap the cleanup at 25s (slightly less than systemd's 30s
//      `TimeoutStopSec`) so the app exits before SIGKILL.
//
// Both adapter-node's handlers and ours fire. Adapter-node closes
// the HTTP server; we close the long-lived clients. Whichever path
// finishes last lets Node's event loop drain and the process exit
// with code 0.

import { closePool, closeClickhouse } from "@glassmkr/db";
import { quitRedis } from "./redis";

const SHUTDOWN_TIMEOUT_MS = 25_000;

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log(`[shutdown] ${signal} received (already shutting down)`);
    return;
  }
  isShuttingDown = true;
  console.log(`[shutdown] ${signal} received, beginning graceful shutdown`);

  // Hard cap. If something hangs longer than this, force-exit so
  // systemd doesn't have to SIGKILL us.
  const hardCap = setTimeout(() => {
    console.error(`[shutdown] hit ${SHUTDOWN_TIMEOUT_MS}ms timeout, forcing exit(1)`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Don't keep the loop alive just for this timer.
  hardCap.unref();

  // Close long-lived clients in parallel. Each helper swallows its
  // own errors (logged) so the others still get a chance to drain.
  await Promise.allSettled([
    closePool(),
    closeClickhouse(),
    quitRedis(),
  ]);

  console.log("[shutdown] all clients closed, exiting 0");
  clearTimeout(hardCap);
  // adapter-node's handler is also winding down the HTTP server; let
  // Node's event loop drain naturally. If something pins it open
  // beyond the loop's natural drain, the hard-cap above ensures we
  // still exit.
  // Explicit exit makes the deterministic-exit guarantee clearer to
  // operators reading journalctl.
  process.exit(0);
}

let registered = false;

/**
 * Idempotent: called once per process from hooks.server.ts. Subsequent
 * calls are no-ops so test environments that import the module multiple
 * times don't stack handlers.
 */
export function registerGracefulShutdown(): void {
  if (registered) return;
  registered = true;

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  console.log("[shutdown] handlers registered for SIGTERM, SIGINT");
}
