import crypto from "node:crypto";
import type { RequestEvent } from "@sveltejs/kit";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { OAuthPrincipal } from "$lib/server/auth/principal.js";
import { writeAudit } from "$lib/server/auth/audit.js";
import { MCP_PROTOCOL_VERSION } from "$lib/server/oauth/constants.js";
import { hashOAuthValueHex } from "$lib/server/oauth/crypto.js";
import { runWithMcpRequestContext } from "./context.js";
import { createGlassmkrMcpServer } from "./server.js";

// A session is reaped after this long without activity. Kept deliberately
// short: a Claude Code client fans out to many subagents that each open their
// OWN session on the SHARED grant, and a subagent that exits does NOT send an
// explicit MCP close, so its session would otherwise sit idle for the full
// window. The periodic reaper below sweeps on this TTL even when no further
// request arrives on the process.
const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;
const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
// Caps raised from 3 / 10 (429 hotfix, 2026-09-16): legitimate subagent fan-out
// on a shared grant needs headroom. With the short idle TTL plus the active
// reaper keeping the map drained, these are comfortable ceilings.
const MAX_SESSIONS_PER_GRANT = 20;
const MAX_SESSIONS_PER_ACCOUNT = 40;

interface McpSessionBinding {
  customerId: string;
  userId: string;
  clientId: string;
  grantId: string;
  resource: string;
}

interface McpSessionEntry {
  sessionHash: string;
  binding: McpSessionBinding;
  protocolVersion: string;
  createdAt: number;
  lastActivityAt: number;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSessionEntry>();
const pendingByGrant = new Map<string, number>();
const pendingByAccount = new Map<string, number>();

// The session map lives in this process's memory, so MCP requires a SINGLE app
// instance: under multi-process clustering a session created on one worker is a
// silent 404 on another. Prod runs one systemd instance today; this warns loudly
// if a known clustering indicator says otherwise (the runbook documents the
// invariant, and a shared session store is the fix if MCP ever scales out).
(function warnIfClustered(): void {
  const concurrency = Number(process.env.WEB_CONCURRENCY ?? "1");
  const clustered = (Number.isFinite(concurrency) && concurrency > 1)
    || process.env.NODE_APP_INSTANCE !== undefined
    || process.env.pm_id !== undefined;
  if (clustered) {
    console.warn(
      "[mcp] multi-process clustering indicator detected (WEB_CONCURRENCY/NODE_APP_INSTANCE/pm_id); MCP sessions are in-memory and per-process and will intermittently 404. Run MCP on a single instance or add a shared session store.",
    );
  }
})();

function jsonRpcHttpError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(extraHeaders ?? {}),
      },
    },
  );
}

// How long a client should wait before retrying after a 429 (seconds). Matches
// the reaper cadence: a stale session is reaped within one sweep.
const RETRY_AFTER_SECONDS = "60";

function bindingFor(principal: OAuthPrincipal): McpSessionBinding {
  return {
    customerId: principal.customer_id,
    userId: principal.user_id,
    clientId: principal.client_id,
    grantId: principal.grant_id,
    resource: principal.resource,
  };
}

function sameBinding(binding: McpSessionBinding, principal: OAuthPrincipal): boolean {
  return binding.customerId === principal.customer_id
    && binding.userId === principal.user_id
    && binding.clientId === principal.client_id
    && binding.grantId === principal.grant_id
    && binding.resource === principal.resource;
}

async function removeSession(entry: McpSessionEntry): Promise<void> {
  if (!sessions.delete(entry.sessionHash)) return;
  await entry.transport.close().catch(() => {});
}

async function expireStaleSessions(now: number): Promise<void> {
  const expired = [...sessions.values()].filter(
    (entry) => now - entry.lastActivityAt > SESSION_IDLE_TTL_MS
      || now - entry.createdAt > SESSION_ABSOLUTE_TTL_MS,
  );
  await Promise.all(expired.map(removeSession));
}

// Periodic reaper. expireStaleSessions also runs at the top of every request,
// but a grant that has gone fully idle (every subagent exited) produces no
// further requests, so without a timer its sessions would linger until some
// unrelated request happens to arrive on the process. The interval drains them
// regardless. unref() so it never keeps the process alive (tests, shutdown).
const REAPER_INTERVAL_MS = 60 * 1000;
let reaperTimer: ReturnType<typeof setInterval> | null = null;
function ensureReaper(): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    void expireStaleSessions(Date.now());
  }, REAPER_INTERVAL_MS);
  reaperTimer.unref?.();
}

function reserveSessionSlot(principal: OAuthPrincipal): boolean {
  let grantCount = 0;
  let accountCount = 0;
  for (const entry of sessions.values()) {
    if (entry.binding.grantId === principal.grant_id) grantCount += 1;
    if (entry.binding.customerId === principal.customer_id) accountCount += 1;
  }
  grantCount += pendingByGrant.get(principal.grant_id) ?? 0;
  accountCount += pendingByAccount.get(principal.customer_id) ?? 0;
  if (grantCount >= MAX_SESSIONS_PER_GRANT || accountCount >= MAX_SESSIONS_PER_ACCOUNT) {
    return false;
  }
  pendingByGrant.set(principal.grant_id, (pendingByGrant.get(principal.grant_id) ?? 0) + 1);
  pendingByAccount.set(
    principal.customer_id,
    (pendingByAccount.get(principal.customer_id) ?? 0) + 1,
  );
  return true;
}

function releaseSessionSlot(principal: OAuthPrincipal): void {
  for (const [map, key] of [
    [pendingByGrant, principal.grant_id],
    [pendingByAccount, principal.customer_id],
  ] as const) {
    const next = (map.get(key) ?? 1) - 1;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }
}

function requestedProtocolVersion(body: unknown): string {
  if (
    body
    && typeof body === "object"
    && "params" in body
    && body.params
    && typeof body.params === "object"
    && "protocolVersion" in body.params
    && typeof body.params.protocolVersion === "string"
  ) {
    return body.params.protocolVersion;
  }
  return MCP_PROTOCOL_VERSION;
}

async function handleWithEntry(
  event: RequestEvent,
  principal: OAuthPrincipal,
  entry: McpSessionEntry,
  parsedBody?: unknown,
): Promise<Response> {
  entry.lastActivityAt = Date.now();
  return runWithMcpRequestContext(
    { event, principal, sessionHash: entry.sessionHash },
    () => entry.transport.handleRequest(event.request, {
      parsedBody,
      authInfo: {
        token: principal.token_id,
        clientId: principal.client_id,
        scopes: [...principal.scopes],
        resource: new URL(principal.resource),
      },
    }),
  );
}

export async function handleMcpGatewayRequest(
  event: RequestEvent,
  principal: OAuthPrincipal,
  parsedBody?: unknown,
): Promise<Response> {
  const now = Date.now();
  ensureReaper();
  await expireStaleSessions(now);

  const rawSessionId = event.request.headers.get("mcp-session-id");
  if (rawSessionId) {
    if (rawSessionId.length > 256) return jsonRpcHttpError(404, "Session not found");
    const sessionHash = hashOAuthValueHex("mcp-session-id", rawSessionId);
    const entry = sessions.get(sessionHash);
    if (!entry) return jsonRpcHttpError(404, "Session not found");
    if (!sameBinding(entry.binding, principal)) {
      await removeSession(entry);
      return jsonRpcHttpError(401, "Session authorization changed");
    }
    const suppliedProtocolVersion = event.request.headers.get("mcp-protocol-version");
    if (suppliedProtocolVersion && suppliedProtocolVersion !== entry.protocolVersion) {
      return jsonRpcHttpError(400, "MCP protocol version does not match the session");
    }
    return handleWithEntry(event, principal, entry, parsedBody);
  }

  if (event.request.method !== "POST" || !isInitializeRequest(parsedBody)) {
    return jsonRpcHttpError(400, "An initialize request is required");
  }
  if (!reserveSessionSlot(principal)) {
    return jsonRpcHttpError(429, "Too many active MCP sessions", {
      "Retry-After": RETRY_AFTER_SECONDS,
    });
  }

  const mcpServer = createGlassmkrMcpServer();
  let createdSessionHash: string | null = null;
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomBytes(32).toString("base64url"),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        const sessionHash = hashOAuthValueHex("mcp-session-id", sessionId);
        createdSessionHash = sessionHash;
        const initializedEntry: McpSessionEntry = {
          sessionHash,
          binding: bindingFor(principal),
          protocolVersion: requestedProtocolVersion(parsedBody),
          createdAt: now,
          lastActivityAt: now,
          transport,
        };
        sessions.set(sessionHash, initializedEntry);
        // The initialize request carries no incoming Mcp-Session-Id header, so
        // the route's transport-level audit cannot see this session. Record its
        // creation here with the session hash so the session has an audit anchor.
        void writeAudit({
          event,
          principal,
          action: "mcp_session_created",
          result: "success",
          status_code: 200,
          resource_type: "mcp_session",
          mcp_session_hash: sessionHash,
        });
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(hashOAuthValueHex("mcp-session-id", sessionId));
      },
    });
    // Belt-and-suspenders: onsessionclosed fires on an explicit MCP session
    // close, but the transport can also close underneath us (stream dropped,
    // shutdown). Drop the map entry on any transport close so a dead transport
    // never holds a session slot until the TTL.
    transport.onclose = () => {
      if (createdSessionHash) sessions.delete(createdSessionHash);
    };
    await mcpServer.connect(transport);
    const response = await runWithMcpRequestContext(
      { event, principal, sessionHash: null },
      () => transport.handleRequest(event.request, {
        parsedBody,
        authInfo: {
          token: principal.token_id,
          clientId: principal.client_id,
          scopes: [...principal.scopes],
          resource: new URL(principal.resource),
        },
      }),
    );
    const initializedEntry = transport.sessionId
      ? sessions.get(hashOAuthValueHex("mcp-session-id", transport.sessionId))
      : undefined;
    if (initializedEntry) {
      try {
        const payload = await response.clone().json() as {
          result?: { protocolVersion?: unknown };
        };
        if (typeof payload.result?.protocolVersion === "string") {
          initializedEntry.protocolVersion = payload.result.protocolVersion;
        }
      } catch {
        // The transport owns response validation. Keep the requested version if
        // a future transport returns a non-JSON initialization body.
      }
    }
    if (!initializedEntry) await mcpServer.close().catch(() => {});
    return response;
  } catch (error) {
    // If onsessioninitialized already registered the session before the failure,
    // remove it so a dead transport does not leak in the session map (its
    // absolute/idle TTL would otherwise keep it discoverable until expiry).
    if (createdSessionHash) {
      const leaked = sessions.get(createdSessionHash);
      if (leaked) await removeSession(leaked);
    }
    await mcpServer.close().catch(() => {});
    throw error;
  } finally {
    releaseSessionSlot(principal);
  }
}

export interface ActiveMcpSession {
  grantId: string;
  clientId: string;
  createdAt: number;
  lastActivityAt: number;
  protocolVersion: string;
}

/** Active MCP sessions for one account, most-recently-active first. Stale
 *  sessions are expired first so the count reflects what is actually live, not
 *  what is merely waiting for the next reaper sweep. Reads the in-process
 *  session map, which is authoritative only because MCP runs on a single
 *  instance (see warnIfClustered). */
export async function getActiveMcpSessionsForCustomer(
  customerId: string,
): Promise<{ count: number; sessions: ActiveMcpSession[] }> {
  await expireStaleSessions(Date.now());
  const list: ActiveMcpSession[] = [];
  for (const entry of sessions.values()) {
    if (entry.binding.customerId !== customerId) continue;
    list.push({
      grantId: entry.binding.grantId,
      clientId: entry.binding.clientId,
      createdAt: entry.createdAt,
      lastActivityAt: entry.lastActivityAt,
      protocolVersion: entry.protocolVersion,
    });
  }
  list.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return { count: list.length, sessions: list };
}

export function resetMcpSessionsForTests(): void {
  sessions.clear();
  pendingByGrant.clear();
  pendingByAccount.clear();
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

/** Test hook: run one reaper sweep as if the clock read `now`. */
export async function reapStaleSessionsNowForTests(now: number = Date.now()): Promise<void> {
  await expireStaleSessions(now);
}

export function getMcpSessionCountForTests(): number {
  return sessions.size;
}
