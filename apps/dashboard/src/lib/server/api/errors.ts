// One error shape for everything under /api/.
//
// An external agent-readiness audit probed the live API and got three different
// answers to "what went wrong":
//
//   GET /api/v1/servers        (no auth)  -> 401 {"message":"Authentication required"}
//   GET /api/v1/does-not-exist            -> 404 text/html, the whole app shell
//   GET /api/v1/ingest         (wrong verb) -> 405 "GET method not allowed", no content-type
//
// A human reads all three and understands. An autonomous client parsing JSON
// gets a doctype, and a client deciding whether to retry, reauthenticate, fix
// its input or stop has nothing to branch on: a human sentence is not a
// contract.
//
// This is deliberately applied at the BOUNDARY rather than by rewriting the
// couple of hundred inline error returns across 53 route files. Every thrown
// error() already funnels through handleError, and the two cases that never
// reach a route at all (unmatched path, wrong method) are caught in hooks. That
// covers the whole namespace in one place instead of relying on 53 files
// agreeing with each other forever.
//
// NOT applied to /oauth/*: RFC 6749 mandates {error, error_description} and an
// OAuth client is entitled to expect exactly that. See lib/server/oauth/responses.ts.

export interface ApiErrorBody {
  /** Stable machine code. Branch on this, never on `message`. */
  error: string;
  /** Short human explanation. May change wording at any time. */
  message: string;
  /** Correlates with the X-Request-Id response header. */
  request_id: string | null;
  documentation_url: string;
  /** Whether an identical retry could plausibly succeed. */
  retryable: boolean;
  retry_after_seconds: number | null;
  details: unknown[];
}

const DOCS = "https://glassmkr.com/docs/api/errors";

// Default machine code per status, for errors thrown without one. Chosen so a
// client can branch usefully even where a callsite has not been given an
// explicit code yet.
const CODE_BY_STATUS: Record<number, string> = {
  400: "invalid_request",
  401: "unauthenticated",
  402: "payment_required",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  410: "gone",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
  500: "internal_error",
  502: "upstream_error",
  503: "unavailable",
  504: "upstream_timeout",
};

// Retryable means "an identical retry could plausibly succeed". A 429 or a
// transient upstream failure qualifies; a malformed request or a missing
// credential does not, because retrying it unchanged just burns quota. Being
// explicit matters more than being generous: an agent that retries a 403 in a
// loop is worse than one that stops.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? "internal_error" : "request_failed");
}

export function apiErrorBody(input: {
  status: number;
  message: string;
  code?: string;
  requestId?: string | null;
  retryAfterSeconds?: number | null;
  details?: unknown[];
}): ApiErrorBody {
  const code = input.code ?? codeForStatus(input.status);
  return {
    error: code,
    message: input.message,
    request_id: input.requestId ?? null,
    documentation_url: `${DOCS}#${code}`,
    retryable: RETRYABLE.has(input.status),
    retry_after_seconds: input.retryAfterSeconds ?? null,
    details: input.details ?? [],
  };
}

/** True for paths this envelope owns. /oauth/* keeps its RFC 6749 shape. */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}
