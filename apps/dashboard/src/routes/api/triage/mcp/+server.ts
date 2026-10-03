// scope: public
// Anonymous paste-triage MCP endpoint for ChatGPT and Claude connectors.
//
// Lives under /api/ on purpose: the Cloudflare rule that turns Browser
// Integrity Check off covers /api/* only, and the connector platforms call
// from their servers, so any other path risks a 1010 block.
//
// Stateless Streamable HTTP with JSON responses: a fresh McpServer and
// transport per POST, no sessions, no auth, no cookies, no database. GET and
// DELETE (SSE stream and session close) do not apply to a stateless server and
// answer 405. Abuse control is three token buckets: per source IP and global
// here, per anonymous end user inside the tool handlers. The request body is
// never logged; see $lib/server/triage/mcp-server.ts for the one log line per
// tool call.
//
// MCP_TRIAGE_ENABLED="0" turns the endpoint off (404) and "1" turns it on.
// Unset: on for the hosted deployment, off for self-hosted, so an
// internet-facing self-hosted dashboard never gains an unauthenticated
// endpoint its operator did not opt into.

import type { RequestHandler } from "./$types";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { take, type RateLimitConfig } from "$lib/server/auth/rate-limit.js";
import { getSourceIp } from "$lib/server/auth/source-ip.js";
import { getMcpPublicOrigin } from "$lib/server/oauth/constants.js";
import { createTriageMcpServer } from "$lib/server/triage/mcp-server.js";
import { SELF_HOSTED } from "$lib/server/self-hosted";

const MAX_POST_BODY_BYTES = 256 * 1024;
const MAX_BATCH_ITEMS = 10;
const ALLOW_METHODS = "POST, OPTIONS";

// Generous per IP: a connector platform calls from a small pool of egress IPs
// shared by many users, and the per-user bucket lives in the tool handler.
const TIER_TRIAGE_IP: RateLimitConfig = { namespace: "triage:ip", capacity: 60, refillPerSecond: 1 };
// Ceiling for the whole endpoint, so a flood from many IPs cannot monopolise
// the evaluator on a single-process dashboard.
const TIER_TRIAGE_GLOBAL: RateLimitConfig = { namespace: "triage:global", capacity: 600, refillPerSecond: 20 };

function isTriageEnabled(): boolean {
  const flag = process.env.MCP_TRIAGE_ENABLED;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return !SELF_HOSTED;
}

function jsonRpcHttpError(
  status: number,
  code: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extraHeaders ?? {}) },
    },
  );
}

function validateHost(event: Parameters<RequestHandler>[0]): boolean {
  const expected = new URL(getMcpPublicOrigin()).host;
  return (event.request.headers.get("host") ?? event.url.host) === expected;
}

/**
 * The caller's Origin when it is an exact https origin, null when there is no
 * Origin header (server-to-server calls), false for anything else. There are no
 * credentials to protect, so any https origin may read the response; plain
 * http and opaque ("null") origins are refused.
 */
function corsOrigin(request: Request): string | null | false {
  const raw = request.headers.get("origin");
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.origin === raw) return url.origin;
  } catch {
    // fall through
  }
  return false;
}

function withHeaders(response: Response, origin: string | null): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

/** Flag and Host checks shared by every method. */
function gate(event: Parameters<RequestHandler>[0]): Response | null {
  if (!isTriageEnabled()) return new Response("Not found", { status: 404 });
  if (!validateHost(event)) return jsonRpcHttpError(421, -32000, "Misdirected request");
  return null;
}

async function routeLimited(event: Parameters<RequestHandler>[0]): Promise<Response | null> {
  for (const [tier, id] of [
    [TIER_TRIAGE_IP, getSourceIp(event)],
    [TIER_TRIAGE_GLOBAL, "all"],
  ] as const) {
    const result = await take(tier, id);
    if (!result.allowed) {
      const wait = Math.max(1, result.retryAfterSeconds);
      console.log(JSON.stringify({ evt: "triage_rate_limited", tier: tier.namespace }));
      return jsonRpcHttpError(429, -32000, `Rate limit exceeded; retry after ${wait} seconds`, {
        "Retry-After": String(wait),
      });
    }
  }
  return null;
}

class BodyTooLarge extends Error {}

/** Read at most MAX_POST_BODY_BYTES; anything longer is refused without buffering it all. */
async function readCappedBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_POST_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_POST_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export const POST: RequestHandler = async (event) => {
  const blocked = gate(event);
  if (blocked) return blocked;

  const origin = corsOrigin(event.request);
  if (origin === false) return withHeaders(jsonRpcHttpError(403, -32000, "Origin is not allowed"), null);

  const limited = await routeLimited(event);
  if (limited) return withHeaders(limited, origin);

  const contentType = event.request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return withHeaders(jsonRpcHttpError(415, -32000, "Content-Type must be application/json"), origin);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await readCappedBody(event.request));
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return withHeaders(jsonRpcHttpError(413, -32000, "Request body is too large"), origin);
    }
    return withHeaders(jsonRpcHttpError(400, -32700, "Parse error: invalid JSON"), origin);
  }
  if (Array.isArray(parsedBody) && parsedBody.length > MAX_BATCH_ITEMS) {
    return withHeaders(jsonRpcHttpError(400, -32600, `Batch too large: at most ${MAX_BATCH_ITEMS} messages`), origin);
  }

  const server = createTriageMcpServer();
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(event.request, { parsedBody });
    return withHeaders(response, origin);
  } catch (error) {
    console.error(`[triage-mcp] transport request failed: ${error instanceof Error ? error.name : "unknown"}`);
    return withHeaders(jsonRpcHttpError(500, -32603, "Internal error"), origin);
  } finally {
    await server.close().catch(() => {});
  }
};

const methodNotAllowed: RequestHandler = async (event) => {
  const blocked = gate(event);
  if (blocked) return blocked;
  const origin = corsOrigin(event.request);
  return withHeaders(
    jsonRpcHttpError(405, -32000, "Method not allowed: this stateless endpoint accepts POST only", { Allow: ALLOW_METHODS }),
    origin || null,
  );
};

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

export const OPTIONS: RequestHandler = async (event) => {
  const blocked = gate(event);
  if (blocked) return blocked;
  const origin = corsOrigin(event.request);
  if (!origin) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": ALLOW_METHODS,
      "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
};
