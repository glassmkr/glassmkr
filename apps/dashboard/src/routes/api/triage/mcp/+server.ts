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
// answer 405. Abuse control is token buckets: per source IP, per IPv6 /64 and
// /48, and global (tool calls only) here, per anonymous end user inside the
// tool handlers. Browsers are held to the connector origins plus loopback. The
// request body is never logged; see $lib/server/triage/mcp-server.ts for the
// one log line per tool call.
//
// MCP_TRIAGE_ENABLED="0" turns the endpoint off (404) and "1" turns it on.
// Unset: on for the hosted deployment, off for self-hosted, so an
// internet-facing self-hosted dashboard never gains an unauthenticated
// endpoint its operator did not opt into.

import { isIPv6 } from "node:net";
import type { RequestHandler } from "./$types";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { take, type RateLimitConfig } from "$lib/server/auth/rate-limit.js";
import { getSourceIp } from "$lib/server/auth/source-ip.js";
import { getMcpPublicOrigin } from "$lib/server/oauth/constants.js";
import { createTriageMcpServer } from "$lib/server/triage/mcp-server.js";
import { SELF_HOSTED } from "$lib/server/self-hosted";

const MAX_POST_BODY_BYTES = 256 * 1024;
const ALLOW_METHODS = "POST, OPTIONS";

// Generous per IP: a connector platform calls from a small pool of egress IPs
// shared by many users, and the per-user bucket lives in the tool handler.
const TIER_TRIAGE_IP: RateLimitConfig = { namespace: "triage:ip", capacity: 60, refillPerSecond: 1 };
// An IPv6 host usually holds a whole /64, so per-address buckets gave one host
// 2^64 fresh buckets and it could hold the global bucket below at zero for
// every ChatGPT and Claude user (R1-15). One /64 now gets at most a fifth of
// the global refill. It is a second bucket, not a re-key of the per-IP one: a
// connector platform calling from many addresses in one /64 keeps more than a
// single address's allowance.
const TIER_TRIAGE_NET64: RateLimitConfig = { namespace: "triage:net64", capacity: 120, refillPerSecond: 4 };
// A residential /56 holds 256 /64s and a tunnel-broker /48 65,536, so five /64s
// of one allocation matched the global refill and eight held it at zero for
// everyone else (R2-6). The whole /48 gets less than a third of it.
const TIER_TRIAGE_NET48: RateLimitConfig = { namespace: "triage:net48", capacity: 180, refillPerSecond: 6 };
// Ceiling for the whole endpoint, so a flood from many IPs cannot monopolise
// the evaluator on a single-process dashboard. Debited only by tool calls,
// after the body is read: the evaluator runs there, and a malformed body or a
// notification spent a token everyone shares (R2-6).
const TIER_TRIAGE_GLOBAL: RateLimitConfig = { namespace: "triage:global", capacity: 600, refillPerSecond: 20 };

// The connector platforms call from their servers, with no Origin. A browser
// always sends one, so only these may call from a page: the connector hosts,
// and loopback for a local inspector (MCP Inspector's Direct mode, R2-24). Any
// https origin used to pass, which let any web page spend the shared buckets
// from every visitor's browser (R2-6).
const CONNECTOR_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com", "https://claude.ai"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The address's /64 and /48 ("2001:db8:1:2::/64", "2001:db8:1::/48"), or null unless it is IPv6 (IPv4-mapped excluded). */
function ipv6Prefixes(ip: string): { net64: string; net48: string } | null {
  const addr = ip.trim().split("%")[0].toLowerCase();
  if (!isIPv6(addr) || /^::ffff:\d/.test(addr)) return null;
  const halves = addr.split("::");
  // An embedded IPv4 tail is two groups; only the first four groups matter here.
  const groups = (part: string | undefined) =>
    part ? part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : [];
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  const all = halves.length > 1 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (all.length !== 8) return null;
  const hex = all.map((g) => parseInt(g, 16).toString(16));
  return { net64: `${hex.slice(0, 4).join(":")}::/64`, net48: `${hex.slice(0, 3).join(":")}::/48` };
}

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
 * The caller's Origin when it is a connector host or a loopback origin, null
 * when there is no Origin header (server-to-server calls), false for anything
 * else, including opaque ("null") origins. There are no credentials to
 * protect; the allowlist is there so a third-party page cannot spend the
 * shared rate limits from its visitors' browsers.
 */
function corsOrigin(request: Request): string | null | false {
  const raw = request.headers.get("origin");
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== raw) return false;
    if (CONNECTOR_ORIGINS.has(url.origin)) return url.origin;
    if ((url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
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

async function limited(tiers: Array<readonly [RateLimitConfig, string]>): Promise<Response | null> {
  for (const [tier, id] of tiers) {
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

/** Per-source buckets, debited by every POST before its body is read. */
function sourceLimited(event: Parameters<RequestHandler>[0]): Promise<Response | null> {
  const ip = getSourceIp(event);
  const prefixes = ipv6Prefixes(ip);
  const tiers: Array<readonly [RateLimitConfig, string]> = [[TIER_TRIAGE_IP, ip]];
  if (prefixes) tiers.push([TIER_TRIAGE_NET64, prefixes.net64], [TIER_TRIAGE_NET48, prefixes.net48]);
  return limited(tiers);
}

class BodyTooLarge extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

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

  const sourceBlocked = await sourceLimited(event);
  if (sourceBlocked) return withHeaders(sourceBlocked, origin);

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
  // MCP 2025-06-18 removed JSON-RPC batching, and ChatGPT and Claude never
  // send one. A batch that also cancels its own request left the transport
  // waiting forever for a response the SDK never sends, so the POST hung
  // until the proxy timed out (R1-14). Rejecting every batch is a deliberate
  // departure from 2025-03-26, which says a server MUST accept them: passed
  // through, one POST could also carry dozens of tools/call past the global
  // bucket below, which is debited once per POST.
  if (Array.isArray(parsedBody)) {
    return withHeaders(jsonRpcHttpError(400, -32600, "Batch requests are not supported"), origin);
  }
  // CallToolRequest.params.arguments is optional in MCP, but the SDK validates
  // a missing one as a non-object, so a client calling the no-argument tool
  // without it got an error instead of the result (R1-33). A null is read the
  // same way; anything else that is not an object is invalid params, not the
  // SDK's -32603 Internal error with its schema dump.
  if (isPlainObject(parsedBody) && parsedBody.method === "tools/call" && isPlainObject(parsedBody.params)) {
    const args = parsedBody.params.arguments;
    if (args === undefined || args === null) parsedBody.params.arguments = {};
    else if (!isPlainObject(args)) {
      return withHeaders(jsonRpcHttpError(400, -32602, "Invalid params: tool arguments must be an object"), origin);
    }
  }
  if (isPlainObject(parsedBody) && parsedBody.method === "tools/call") {
    const globalBlocked = await limited([[TIER_TRIAGE_GLOBAL, "all"]]);
    if (globalBlocked) return withHeaders(globalBlocked, origin);
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
