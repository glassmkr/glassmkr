// LB-3 (Grok + Codex security review, 2026-09-01): exact-Origin enforcement for
// cookie-authenticated, state-changing requests.
//
// SvelteKit's built-in checkOrigin is disabled in svelte.config.js so the OAuth
// 2.1 machine endpoints can accept the cross-origin, form-encoded POSTs the spec
// requires (they authenticate with client_id + PKCE + a one-time code, not the
// session cookie). The hook re-applies a check for every other path. The old
// version only inspected form content types, which missed the real exploit: a
// sibling-origin XSS can send application/json as a Blob with an empty media
// type, a CORS-simple request that carries the shared session cookie and never
// triggers a preflight. So the check is keyed on whether the request carries the
// ambient session cookie, not on its content type.
//
// This is a pure decision function so its full contract is unit-tested (the
// house rule: a hand-rolled framework control must match the framework's full
// behavior, and every guard needs known-bad fixtures).

export const CSRF_EXEMPT_PATHS = new Set([
  "/oauth/token",
  "/oauth/revoke",
  "/oauth/register",
]);

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isFormContentType(contentType: string | null): boolean {
  const type = (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  return (
    type === "application/x-www-form-urlencoded" ||
    type === "multipart/form-data" ||
    type === "text/plain" ||
    // SvelteKit treats its own progressive-enhancement content type as a form
    // submission for checkOrigin; mirror that so this guard is not laxer than
    // the framework default it replaces.
    type === "application/x-sveltekit-formdata"
  );
}

// Returns true when the request must be REJECTED as a cross-site state change.
//
// Checked when the request is mutating, not an OAuth-machine path, and EITHER
// carries the ambient session cookie OR is a browser form post. The Origin then
// must be present AND exactly the site origin:
//   - a missing / null Origin fails CLOSED (Codex: do not treat absence as safe);
//   - Sec-Fetch-Site is intentionally NOT consulted, because a sibling subdomain
//     is same-site yet a different origin.
// A request authenticated ONLY by an Authorization header (no session cookie) is
// exempt: the browser never attaches that header cross-origin, so it cannot be
// driven by CSRF. When the session cookie IS present we enforce regardless of any
// Authorization header, because the auth handle resolves the cookie first (a
// leaked-but-unused Bearer must not weaken the cookie session's protection).
export function isCsrfViolation(input: {
  method: string;
  pathname: string;
  hasSessionCookie: boolean;
  contentType: string | null;
  origin: string | null;
  siteOrigin: string;
}): boolean {
  if (!MUTATING.has(input.method.toUpperCase())) return false;
  if (CSRF_EXEMPT_PATHS.has(input.pathname)) return false;
  const ambient = input.hasSessionCookie || isFormContentType(input.contentType);
  if (!ambient) return false;
  return input.origin === null || input.origin !== input.siteOrigin;
}
