import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { closePool, closeClickhouse } from "@glassmkr/db";

/**
 * Cloudflare Access verification.
 *
 * In production we verify the `cf-access-jwt-assertion` header against
 * Cloudflare's JWKS for our team domain and check the audience claim
 * matches the configured AUD tag for the ops application. Without this,
 * any request that reaches the Node service directly (e.g. via the
 * private VPN or a misconfigured CF rule) could spoof the headers and
 * impersonate an admin. See BOLA audit 2026-04-22.
 *
 * In dev mode we skip verification so local work without CF Access
 * still functions; admin routes can then authorise via OPS_ADMIN_DEV_SECRET.
 *
 * Required env (production):
 *   CF_ACCESS_TEAM_DOMAIN  e.g. glassmkr.cloudflareaccess.com
 *   CF_ACCESS_AUD          the AUD tag from the ops Access application
 */

const TEAM_DOMAIN = process.env.CF_ACCESS_TEAM_DOMAIN ?? "";
const AUD = process.env.CF_ACCESS_AUD ?? "";

// `createRemoteJWKSet` returns a resolver that caches keys in-memory and
// refreshes on unknown kid. One instance per process.
const jwks = TEAM_DOMAIN
  ? createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`))
  : null;

// Graceful shutdown: PG pool + ClickHouse client drain on SIGTERM/SIGINT
// so systemd doesn't have to SIGKILL the process. adapter-node already
// closes the HTTP server; we close the long-lived clients. Idempotent
// (registered once per process).
let shutdownRegistered = false;
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[ops:shutdown] ${signal} received, draining clients`);
  const hardCap = setTimeout(() => {
    console.error("[ops:shutdown] 25s timeout, forcing exit(1)");
    process.exit(1);
  }, 25_000);
  hardCap.unref();
  await Promise.allSettled([closePool(), closeClickhouse()]);
  clearTimeout(hardCap);
  console.log("[ops:shutdown] clients closed, exit 0");
  process.exit(0);
}

if (!shutdownRegistered) {
  shutdownRegistered = true;
  process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
  process.on("SIGINT",  () => { void gracefulShutdown("SIGINT"); });
}

function unauthorized(msg: string): Response {
  return new Response(`Unauthorized: ${msg}`, { status: 401 });
}

export const handle: Handle = async ({ event, resolve }) => {
  if (dev) {
    event.locals.authorized = true;
    event.locals.email = null;
    return resolve(event);
  }

  if (!jwks || !AUD) {
    // Fail closed: in production we require both env vars to be set.
    console.error(
      "[ops] CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not configured; rejecting request",
    );
    return unauthorized("ops auth not configured");
  }

  const jwt = event.request.headers.get("cf-access-jwt-assertion");
  if (!jwt) return unauthorized("missing Cloudflare Access token");

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(jwt, jwks, {
      issuer: `https://${TEAM_DOMAIN}`,
      audience: AUD,
    });
    payload = verified.payload;
  } catch (err: any) {
    console.error("[ops] CF Access JWT verification failed:", err?.message);
    return unauthorized("invalid Cloudflare Access token");
  }

  const email =
    typeof payload.email === "string"
      ? payload.email.toLowerCase()
      : null;

  event.locals.authorized = true;
  event.locals.email = email;
  return resolve(event);
};
