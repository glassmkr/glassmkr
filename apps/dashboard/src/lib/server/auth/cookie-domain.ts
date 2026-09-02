import { SELF_HOSTED } from "$lib/server/self-hosted";

// The Domain attribute for session and auth cookies.
//
// The hosted deployment spans two hosts: the marketing site at glassmkr.com
// reads logged-in state that app.glassmkr.com sets, so those cookies need
// Domain=.glassmkr.com to be shared. That value used to be written literally at
// every call site, which meant a self-hosted instance also emitted
// Domain=.glassmkr.com. Browsers silently drop a cookie whose Domain does not
// match the host being visited, so a self-hoster could log in, receive a
// session, and never hold one: the login page just came back. curl does not
// enforce the rule, which is why every check that used curl reported success.
//
// Self-hosted therefore gets host-only cookies (no Domain attribute), which is
// correct for localhost, a LAN address, or the operator's own domain alike.
// COOKIE_DOMAIN overrides both cases for anyone running the hosted shape on
// their own domains; set it to "none" to force host-only.
export function cookieDomain(): string | undefined {
  const explicit = (process.env.COOKIE_DOMAIN ?? "").trim();
  if (explicit) return explicit.toLowerCase() === "none" ? undefined : explicit;
  return SELF_HOSTED ? undefined : ".glassmkr.com";
}

// Whether auth cookies carry the Secure attribute.
//
// The hosted deployment is always HTTPS, so it always sets Secure. A
// self-hosted instance reached over plain HTTP on a LAN address cannot: the
// browser drops a Secure cookie from an insecure origin, which produces the
// same invisible "login does nothing" symptom as a mismatched Domain. The
// documented LAN example (http://10.0.0.5:3000) is exactly that case.
// localhost happens to be exempt in modern browsers, which is why a loopback
// test would not have caught this either.
export function cookieSecure(event: { url: URL }): boolean {
  if (!SELF_HOSTED) return true;
  return event.url.protocol === "https:";
}

// The attribute suffix for handlers that build a Set-Cookie header by hand
// rather than going through event.cookies.set.
export function cookieAttrs(event: { url: URL }): string {
  const domain = cookieDomain();
  return `${cookieSecure(event) ? "; Secure" : ""}${domain ? `; Domain=${domain}` : ""}`;
}

// The attribute suffix for the AUTH cookie (guardian_token). It is deliberately
// HOST-ONLY: no Domain attribute, so it is scoped to app.glassmkr.com and can
// never be read on the marketing site or a sibling subdomain. LB-3 (2026-09-01):
// a Domain=.glassmkr.com auth cookie let a marketing-site XSS reach the app API
// with the victim's session, and permitted sibling cookie-tossing. The marketing
// site's logged-in display now reads the separate, non-sensitive SIGNED_IN_HINT
// cookie instead of the credential.
export function authCookieAttrs(event: { url: URL }): string {
  return cookieSecure(event) ? "; Secure" : "";
}

// Clear an ephemeral OAuth cookie (oauth_state / oauth_redirect / oauth_intent).
// These are now host-only (round-2 #3), so a delete scoped only to the shared
// Domain no longer clears them and a stale value could mislead a later flow
// (e.g. a lingering oauth_intent=reauth breaking a normal login) - round-3 #4.
// Delete BOTH the host-only form and any legacy domain-scoped form.
export function clearOAuthCookie(
  cookies: { delete: (name: string, opts: { path: string; domain?: string }) => void },
  name: string,
): void {
  cookies.delete(name, { path: "/" });
  cookies.delete(name, { path: "/", domain: cookieDomain() });
}

// A non-sensitive presence flag ("1") shared across .glassmkr.com so the
// marketing site can show logged-in state WITHOUT holding the session JWT. It
// carries no credential: leaking it reveals only that some browser has a live
// session. Set alongside guardian_token on login/register/OAuth and cleared on
// logout.
export const SIGNED_IN_HINT = "gmk_signed_in";
