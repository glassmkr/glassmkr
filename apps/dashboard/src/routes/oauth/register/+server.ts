import type { RequestHandler } from "./$types";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { getSourceIp } from "$lib/server/auth/source-ip.js";
import { isMcpDynamicRegistrationEnabled, isMcpOAuthEnabled } from "$lib/server/oauth/constants.js";
import { oauthErrorResponse, oauthJson } from "$lib/server/oauth/responses.js";
import { registerOAuthClient } from "$lib/server/oauth/store.js";
import {
  OAuthRequestError,
  readBoundedRequestBody,
  validateClientName,
  validateRedirectUris,
} from "$lib/server/oauth/validation.js";

const REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
  if (!isMcpOAuthEnabled() || !isMcpDynamicRegistrationEnabled()) {
    return new Response(null, { status: 404 });
  }
  const limit = takeRateLimitHit(
    `mcp-dcr:${getSourceIp(event)}`,
    5,
    REGISTRATION_WINDOW_MS,
  );
  if (!limit.allowed) {
    return oauthJson(
      { error: "temporarily_unavailable", error_description: "registration rate limit exceeded" },
      429,
    );
  }

  try {
    const contentType = event.request.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw new OAuthRequestError("invalid_client_metadata", "JSON content type is required");
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(
        await readBoundedRequestBody(event.request, 16 * 1024),
      ) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OAuthRequestError) throw error;
      throw new OAuthRequestError("invalid_client_metadata", "request body must be valid JSON");
    }
    if (
      body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== "none"
    ) {
      throw new OAuthRequestError(
        "invalid_client_metadata",
        "only public clients with token_endpoint_auth_method=none are supported",
      );
    }
    if (
      body.response_types !== undefined &&
      (!Array.isArray(body.response_types) ||
        body.response_types.length !== 1 ||
        body.response_types[0] !== "code")
    ) {
      throw new OAuthRequestError("invalid_client_metadata", "only response_type=code is supported");
    }
    if (body.grant_types !== undefined) {
      const grants = body.grant_types;
      if (
        !Array.isArray(grants) ||
        grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token") ||
        !grants.includes("authorization_code")
      ) {
        throw new OAuthRequestError(
          "invalid_client_metadata",
          "only authorization_code and refresh_token grants are supported",
        );
      }
    }
    const client = await registerOAuthClient({
      clientName: validateClientName(body.client_name),
      redirectUris: validateRedirectUris(body.redirect_uris),
    });
    return oauthJson(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  } catch (error) {
    return oauthErrorResponse(error);
  }
};
