import type { RequestHandler } from "./$types";
import { takeRateLimitHit } from "@glassmkr/auth/rate-limit";
import { getSourceIp } from "$lib/server/auth/source-ip.js";
import { getMcpResourceUrl, isMcpOAuthEnabled } from "$lib/server/oauth/constants.js";
import { oauthErrorResponse, oauthJson } from "$lib/server/oauth/responses.js";
import { exchangeAuthorizationCode, rotateRefreshToken } from "$lib/server/oauth/tokens.js";
import {
  OAuthRequestError,
  readBoundedRequestBody,
  validatePkceVerifier,
  validateRedirectUri,
} from "$lib/server/oauth/validation.js";

const TOKEN_WINDOW_MS = 10 * 60 * 1000;

function required(form: URLSearchParams, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new OAuthRequestError("invalid_request", `${name} is required`);
  }
  return value;
}

export const POST: RequestHandler = async (event) => {
  if (!isMcpOAuthEnabled()) return new Response(null, { status: 404 });
  const limit = takeRateLimitHit(`mcp-token:${getSourceIp(event)}`, 30, TOKEN_WINDOW_MS);
  if (!limit.allowed) {
    return oauthJson(
      { error: "temporarily_unavailable", error_description: "token rate limit exceeded" },
      429,
    );
  }

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
    const grantType = required(form, "grant_type");
    const clientId = required(form, "client_id");
    const resource = required(form, "resource");
    if (resource !== getMcpResourceUrl()) {
      throw new OAuthRequestError("invalid_target", "resource is not the Glassmkr MCP endpoint");
    }

    const pair = grantType === "authorization_code"
      ? await exchangeAuthorizationCode({
          code: required(form, "code"),
          clientId,
          redirectUri: validateRedirectUri(required(form, "redirect_uri")),
          resource,
          codeVerifier: validatePkceVerifier(required(form, "code_verifier")),
        })
      : grantType === "refresh_token"
        ? await rotateRefreshToken({
            refreshToken: required(form, "refresh_token"),
            clientId,
            resource,
          })
        : (() => {
            throw new OAuthRequestError("unsupported_grant_type", "grant type is not supported");
          })();

    return oauthJson({
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      scope: pair.scope,
      resource,
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
};
