import { getSupportedMcpScopes } from "./constants.js";
import type { OAuthScope } from "$lib/server/auth/principal.js";

const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);

export class OAuthRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "OAuthRequestError";
  }
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new OAuthRequestError("invalid_request", "request body is too large", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new OAuthRequestError("invalid_request", "request body is too large", 413);
  }
  return new TextDecoder().decode(bytes);
}

export function parseRequestedScopes(raw: string | null): OAuthScope[] {
  if (!raw) throw new OAuthRequestError("invalid_scope", "scope is required");
  const values = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (values.length === 0) {
    throw new OAuthRequestError("invalid_scope", "at least one scope is required");
  }
  const supported = new Set<string>(getSupportedMcpScopes());
  if (values.some((scope) => !supported.has(scope))) {
    throw new OAuthRequestError("invalid_scope", "one or more scopes are not supported");
  }
  // Normalize the hierarchy so the granted scope set EXPLICITLY lists everything
  // the token can do at runtime (hasMcpScope treats admin as satisfying write+read,
  // and write as satisfying read). Making the implied scopes explicit keeps the
  // consent screen honest: an admin grant shows the write permission too, not just
  // read (Codex 2026-07-21 #5). bearer.ts also requires read to be present.
  const scopes = new Set<OAuthScope>(values as OAuthScope[]);
  if (scopes.has("glassmkr:admin")) {
    scopes.add("glassmkr:write");
    scopes.add("glassmkr:read");
  } else if (scopes.has("glassmkr:write")) {
    scopes.add("glassmkr:read");
  }
  return [...scopes];
}

export function validatePkceChallenge(value: string | null, method: string | null): string {
  if (method !== "S256" || !value || !PKCE_CHALLENGE_RE.test(value)) {
    throw new OAuthRequestError(
      "invalid_request",
      "code_challenge and code_challenge_method=S256 are required",
    );
  }
  return value;
}

export function validatePkceVerifier(value: string | null): string {
  if (!value || !PKCE_VERIFIER_RE.test(value)) {
    throw new OAuthRequestError("invalid_grant", "code_verifier is invalid");
  }
  return value;
}

export function validateClientName(value: unknown): string {
  if (typeof value !== "string") {
    throw new OAuthRequestError("invalid_client_metadata", "client_name is required");
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 100 || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new OAuthRequestError("invalid_client_metadata", "client_name is invalid");
  }
  return normalized;
}

export function validateRedirectUri(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new OAuthRequestError("invalid_redirect_uri", "redirect URI is invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthRequestError("invalid_redirect_uri", "redirect URI is invalid");
  }
  if (url.hash || url.username || url.password) {
    throw new OAuthRequestError("invalid_redirect_uri", "redirect URI is invalid");
  }
  const isHttps = url.protocol === "https:";
  const isLoopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!isHttps && !isLoopbackHttp) {
    throw new OAuthRequestError(
      "invalid_redirect_uri",
      "redirect URI must use HTTPS or an HTTP loopback address",
    );
  }
  return url.toString();
}

export function validateRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new OAuthRequestError(
      "invalid_client_metadata",
      "redirect_uris must contain between one and five values",
    );
  }
  const uris = [...new Set(value.map(validateRedirectUri))];
  if (uris.length !== value.length) {
    throw new OAuthRequestError("invalid_client_metadata", "redirect_uris must be unique");
  }
  return uris;
}

export function requireExactRedirectUri(
  requested: string | null,
  registered: readonly string[],
): string {
  if (!requested) {
    throw new OAuthRequestError("invalid_request", "redirect_uri is required");
  }
  const normalized = validateRedirectUri(requested);
  if (!registered.includes(normalized)) {
    throw new OAuthRequestError("invalid_request", "redirect_uri is not registered");
  }
  return normalized;
}

export function allowedOriginsForRedirects(redirectUris: readonly string[]): Set<string> {
  return new Set(redirectUris.map((value) => new URL(value).origin));
}

export function appendOAuthRedirectParams(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
