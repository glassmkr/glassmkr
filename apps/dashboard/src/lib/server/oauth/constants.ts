import type { OAuthScope } from "$lib/server/auth/principal.js";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_NAME = "glassmkr";
export const MCP_SERVER_VERSION = "0.1.0";

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
export const OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;
export const OAUTH_REFRESH_IDLE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS = 90 * 24 * 60 * 60;

function enabled(name: string): boolean {
  return process.env[name] === "1";
}

export function isMcpOAuthEnabled(): boolean {
  return enabled("MCP_OAUTH_ENABLED");
}

export function isMcpReadEnabled(): boolean {
  return enabled("MCP_READ_ENABLED");
}

export function isMcpDynamicRegistrationEnabled(): boolean {
  return enabled("MCP_DYNAMIC_REGISTRATION_ENABLED");
}

// Phase 2: mutating (glassmkr:write) tools ship dormant behind their own flag,
// so merging Phase 2 does not expose write until it is explicitly enabled (the
// same rollout discipline read used). admin (destructive) will get its own flag.
export function isMcpWriteEnabled(): boolean {
  return enabled("MCP_WRITE_ENABLED");
}

// Phase 2b: admin (glassmkr:admin) unlocks the destructive tools. The flag exists
// now so the confirm-token + service plumbing can gate on it, but admin is NOT yet
// offered in getSupportedMcpScopes (see below) until the destructive tools land, so
// a client cannot obtain an admin grant that would grant nothing extra.
export function isMcpAdminEnabled(): boolean {
  return enabled("MCP_ADMIN_ENABLED");
}

// Scopes the AS advertises + accepts. glassmkr:write is only offered when the
// write surface is enabled, so a client cannot obtain a write grant against a
// deployment that has not turned it on.
export function getSupportedMcpScopes(): OAuthScope[] {
  const scopes: OAuthScope[] = ["glassmkr:read"];
  if (isMcpWriteEnabled()) scopes.push("glassmkr:write");
  if (isMcpAdminEnabled()) scopes.push("glassmkr:admin");
  return scopes;
}

function allowlistIncludes(name: string, value: string): boolean {
  const configured = process.env[name]?.trim();
  if (!configured) return true;
  return configured
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(value);
}

export function isMcpAccountAllowed(customerId: string): boolean {
  return allowlistIncludes("MCP_ACCOUNT_ALLOWLIST", customerId);
}

export function isMcpClientAllowed(clientId: string): boolean {
  return allowlistIncludes("MCP_CLIENT_ALLOWLIST", clientId);
}

export function getMcpPublicOrigin(): string {
  const configured = process.env.MCP_PUBLIC_ORIGIN?.trim();
  const raw = configured || "https://app.glassmkr.com";
  const url = new URL(raw);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("MCP_PUBLIC_ORIGIN must contain only scheme and host");
  }
  const isLoopbackHttp = url.protocol === "http:"
    && (url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]");
  if (url.protocol !== "https:" && (process.env.NODE_ENV === "production" || !isLoopbackHttp)) {
    throw new Error("MCP_PUBLIC_ORIGIN must use HTTPS, except for local development");
  }
  return url.origin;
}

export function getMcpResourceUrl(): string {
  return `${getMcpPublicOrigin()}/mcp`;
}

export function getProtectedResourceMetadataUrl(): string {
  return `${getMcpPublicOrigin()}/.well-known/oauth-protected-resource/mcp`;
}
