import { json } from "@sveltejs/kit";
import { getProtectedResourceMetadataUrl } from "./constants.js";
import { OAuthRequestError } from "./validation.js";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export function oauthJson(body: unknown, status: number = 200): Response {
  return json(body, { status, headers: NO_STORE_HEADERS });
}

export function oauthErrorResponse(error: unknown): Response {
  if (error instanceof OAuthRequestError) {
    return oauthJson(
      { error: error.code, error_description: error.message },
      error.status,
    );
  }
  console.error("[mcp-oauth] request failed:", (error as Error).message);
  return oauthJson({ error: "server_error" }, 500);
}

export function mcpUnauthorized(scope: string = "glassmkr:read"): Response {
  const resourceMetadata = getProtectedResourceMetadataUrl();
  const response = oauthJson(
    { error: "invalid_token", error_description: "A valid MCP OAuth access token is required" },
    401,
  );
  response.headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadata}", scope="${scope}"`,
  );
  return response;
}
