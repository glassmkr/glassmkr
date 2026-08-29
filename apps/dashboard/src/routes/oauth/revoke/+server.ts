import type { RequestHandler } from "./$types";
import {
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware.js";
import { isMcpOAuthEnabled } from "$lib/server/oauth/constants.js";
import { oauthErrorResponse, oauthJson } from "$lib/server/oauth/responses.js";
import { revokeOAuthToken } from "$lib/server/oauth/tokens.js";
import {
  OAuthRequestError,
  readBoundedRequestBody,
} from "$lib/server/oauth/validation.js";

export const POST: RequestHandler = async (event) => {
  if (!isMcpOAuthEnabled()) return new Response(null, { status: 404 });
  // Throttle by source IP: the endpoint accepts an unauthenticated token guess,
  // so an unbounded caller could probe it. Mirrors the /mcp IP limit.
  const ipLimit = await enforceIpRateLimit(event, { namespaceSuffix: "oauth-revoke" });
  if (ipLimit) return rateLimitedResponse(ipLimit.failure);
  try {
    const contentType = event.request.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") {
      throw new OAuthRequestError("invalid_request", "form-urlencoded content type is required");
    }
    const form = new URLSearchParams(
      await readBoundedRequestBody(event.request, 32 * 1024),
    );
    const token = form.get("token");
    const clientId = form.get("client_id");
    if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
      throw new OAuthRequestError("invalid_request", "token is required");
    }
    if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 2048) {
      throw new OAuthRequestError("invalid_request", "client_id is required");
    }
    await revokeOAuthToken({ token, clientId });
    return oauthJson({});
  } catch (error) {
    return oauthErrorResponse(error);
  }
};
