import type { RequestHandler } from "./$types";
import { writeAudit } from "$lib/server/auth/audit.js";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware.js";
import { TIER_PER_ACCOUNT, TIER_PER_KEY } from "$lib/server/auth/rate-limit.js";
import { authenticateMcpBearer, hasMcpScope } from "$lib/server/oauth/bearer.js";
import {
  getMcpPublicOrigin,
  getProtectedResourceMetadataUrl,
  isMcpAccountAllowed,
  isMcpClientAllowed,
  isMcpOAuthEnabled,
  isMcpReadEnabled,
} from "$lib/server/oauth/constants.js";
import { hashOAuthValueHex } from "$lib/server/oauth/crypto.js";
import { mcpUnauthorized } from "$lib/server/oauth/responses.js";
import { handleMcpGatewayRequest } from "$lib/server/mcp/gateway.js";

const MAX_POST_BODY_BYTES = 256 * 1024;
const MAX_BATCH_ITEMS = 10;

function jsonRpcHttpError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
    { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

function validateHost(event: Parameters<RequestHandler>[0]): boolean {
  const expected = new URL(getMcpPublicOrigin()).host;
  return (event.request.headers.get("host") ?? event.url.host) === expected;
}

function validateOrigin(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): string | null | false {
  const raw = request.headers.get("origin");
  if (!raw) return null;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    return false;
  }
  return origin === getMcpPublicOrigin() || allowedOrigins.has(origin)
    ? origin
    : false;
}

function applyMcpHeaders(response: Response, origin: string | null): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  }
  return response;
}

async function parsePostBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new Error("MCP POST requests require application/json");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_POST_BODY_BYTES) {
    throw new RangeError("MCP request body is too large");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_POST_BODY_BYTES) {
    throw new RangeError("MCP request body is too large");
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (Array.isArray(parsed) && parsed.length > MAX_BATCH_ITEMS) {
    throw new RangeError("MCP request batch is too large");
  }
  return parsed;
}

const handle: RequestHandler = async (event) => {
  if (!isMcpOAuthEnabled() || !isMcpReadEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  if (!validateHost(event)) {
    return jsonRpcHttpError(421, "Misdirected request");
  }

  const ipLimit = await enforceIpRateLimit(event, { namespaceSuffix: "mcp" });
  if (ipLimit) {
    void writeAudit({
      event,
      principal: null,
      action: "mcp_request",
      result: "rate_limited",
      status_code: 429,
      resource_type: "mcp_session",
      metadata: { tier: ipLimit.failure.tier },
    });
    return rateLimitedResponse(ipLimit.failure);
  }

  const principal = await authenticateMcpBearer(event.request);
  if (!principal) {
    void writeAudit({
      event,
      principal: null,
      action: "mcp_request",
      result: "auth_failed",
      status_code: 401,
      resource_type: "mcp_session",
    });
    return mcpUnauthorized();
  }
  if (
    !hasMcpScope(principal, "glassmkr:read")
    || !isMcpAccountAllowed(principal.customer_id)
    || !isMcpClientAllowed(principal.client_id)
  ) {
    void writeAudit({
      event,
      principal,
      action: "mcp_request",
      result: "forbidden",
      status_code: 403,
      resource_type: "mcp_session",
      metadata: { reason: "scope_or_rollout_policy" },
    });
    const response = jsonRpcHttpError(403, "MCP access is not enabled for this grant");
    response.headers.set(
      "WWW-Authenticate",
      'Bearer error="insufficient_scope", scope="glassmkr:read"',
    );
    return response;
  }

  const origin = validateOrigin(event.request, principal.allowed_origins);
  if (origin === false) {
    void writeAudit({
      event,
      principal,
      action: "mcp_request",
      result: "forbidden",
      status_code: 403,
      resource_type: "mcp_session",
      metadata: { reason: "origin" },
    });
    return jsonRpcHttpError(403, "Origin is not allowed");
  }

  const rateLimit = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rateLimit.allowed) {
    void writeAudit({
      event,
      principal,
      action: "mcp_request",
      result: "rate_limited",
      status_code: 429,
      resource_type: "mcp_session",
      metadata: { tier: rateLimit.tier },
    });
    return rateLimitedResponse(rateLimit);
  }

  let parsedBody: unknown;
  if (event.request.method === "POST") {
    try {
      parsedBody = await parsePostBody(event.request);
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 400;
      void writeAudit({
        event,
        principal,
        action: "mcp_request",
        result: "invalid",
        status_code: status,
        resource_type: "mcp_session",
        metadata: { reason: status === 413 ? "body_limit" : "invalid_json" },
      });
      return jsonRpcHttpError(status, status === 413 ? "Request body is too large" : "Invalid JSON request");
    }
  }

  const rawSessionId = event.request.headers.get("mcp-session-id");
  const sessionHash = rawSessionId && rawSessionId.length <= 256
    ? hashOAuthValueHex("mcp-session-id", rawSessionId)
    : undefined;
  try {
    const response = await handleMcpGatewayRequest(event, principal, parsedBody);
    if (response.status === 401) {
      response.headers.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${getProtectedResourceMetadataUrl()}", scope="glassmkr:read"`,
      );
    }
    void writeAudit({
      event,
      principal,
      action: "mcp_transport_request",
      result: response.status < 400
        ? "success"
        : response.status === 401 || response.status === 403
          ? "forbidden"
          : response.status === 429
            ? "rate_limited"
            : "invalid",
      status_code: response.status,
      resource_type: "mcp_session",
      metadata: { method: event.request.method },
      mcp_session_hash: sessionHash,
    });
    return applyMcpHeaders(response, origin);
  } catch {
    console.error(`[mcp] transport request failed for ${(event.locals as { request_id?: string }).request_id ?? "unknown"}`);
    void writeAudit({
      event,
      principal,
      action: "mcp_transport_request",
      result: "error",
      status_code: 500,
      resource_type: "mcp_session",
      mcp_session_hash: sessionHash,
    });
    return applyMcpHeaders(jsonRpcHttpError(500, "MCP request failed"), origin);
  }
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

export const OPTIONS: RequestHandler = async (event) => {
  if (!isMcpOAuthEnabled() || !isMcpReadEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  if (!validateHost(event)) return new Response(null, { status: 421 });
  const rawOrigin = event.request.headers.get("origin");
  if (!rawOrigin) return new Response(null, { status: 403 });
  let origin: string;
  try {
    const parsed = new URL(rawOrigin);
    const loopback = parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
    if ((parsed.protocol !== "https:" && !loopback) || parsed.origin !== rawOrigin) {
      return new Response(null, { status: 403 });
    }
    origin = parsed.origin;
  } catch {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
      "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
};
