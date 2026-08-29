import { json, type Handle, type HandleServerError } from "@sveltejs/kit";
import crypto from "node:crypto";
import { sequence } from "@sveltejs/kit/hooks";
import * as Sentry from "@sentry/sveltekit";
import { handleErrorWithSentry, sentryHandle } from "@sentry/sveltekit";
import { verifyToken, getCustomerById } from "@glassmkr/auth";
import { isSessionStale } from "$lib/server/auth/session-epoch";
import { DEMO_COOKIE } from "$lib/server/auth/demo-cookie";
import { apiErrorBody, isApiPath } from "$lib/server/api/errors";
import { startWatchdog } from "$lib/server/watchdog-scheduler";
import { startTrendWarnings } from "$lib/server/trend-warnings/scheduler";
import { SELF_HOSTED } from "$lib/server/self-hosted";
import { startBillingEnforcement } from "$lib/server/billing/enforcement-scheduler";
import { startEmailReminders } from "$lib/server/billing/email-reminders-scheduler";
import { startKeyExpiry } from "$lib/server/account/key-expiry-scheduler";
import { startEndoflifeSync } from "$lib/server/endoflife/scheduler";
import { registerGracefulShutdown } from "$lib/server/graceful-shutdown";
import { demoDisposition } from "$lib/server/demo-access";

// Server-side Sentry init. Mirrors hooks.client.ts. No-op without
// SENTRY_DSN env var so this file is safe to merge before the
// GlitchTip instance exists. See docs/internal/specs/error-tracking.md
// for the deployment plan.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.GIT_SHA || undefined,
    environment: process.env.NODE_ENV || "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

// Start background schedulers once per process at module load.
startWatchdog();
startTrendWarnings();
// Billing is a hosted-deployment concern. In self-hosted mode the schedulers
// never start: no enforcement sweeps, no payment reminder emails. The code
// stays because the hosted instance runs from this same tree.
if (!SELF_HOSTED) {
  startBillingEnforcement();
  startEmailReminders();
}
startKeyExpiry();
startEndoflifeSync();

// Register SIGTERM/SIGINT handlers so the process drains PG / ClickHouse
// / Redis clients before exit. See graceful-shutdown.ts for the rationale
// (retrospective F1 / CC_SPEC_4_F1_F3_HARDENING).
registerGracefulShutdown();

const requestIdHandle: Handle = async ({ event, resolve }) => {
  event.locals.request_id = crypto.randomUUID();
  const response = await resolve(event);
  response.headers.set("X-Request-Id", event.locals.request_id);
  return response;
};

// SvelteKit builds its own 405 when a route exists but does not export the verb,
// and that response is plain text with no content-type at all:
//
//   GET /api/v1/ingest -> 405, body "GET method not allowed"
//
// It never passes through handleError, and there is no hook for it, so the only
// place to reshape it is here, on the way out. Narrow on purpose: it rewrites a
// response only when the path is under /api/, the status is 405, and the body
// is not already JSON. A healthy response, and any endpoint that already
// answers correctly, is passed through untouched. The Allow header SvelteKit
// set is preserved, because that is the part a client needs in order to retry
// with the right verb.
const apiErrorShapeHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (!isApiPath(event.url.pathname) || response.status < 400) return response;

  // Read the body so it can be re-shaped. Error bodies are small, and only
  // failures reach this point: a successful response is returned above
  // untouched and is never buffered.
  let raw = "";
  try {
    raw = await response.clone().text();
  } catch {
    return response;
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  // An existing `error` string is already a machine code (for example
  // "pro_required"); keep it and fill in what is missing around it rather than
  // flattening a more specific code into a generic one.
  const existingCode = typeof parsed?.error === "string" ? (parsed.error as string) : undefined;
  const allow = response.headers.get("allow");

  const message =
    typeof parsed?.message === "string" && parsed.message
      ? (parsed.message as string)
      : response.status === 405
        ? allow
          ? `${event.request.method} is not supported on this endpoint. Allowed: ${allow}.`
          : `${event.request.method} is not supported on this endpoint.`
        : raw.trim() && !parsed
          ? raw.trim().slice(0, 300)
          : "Request failed";

  const envelope = apiErrorBody({
    status: response.status,
    code: existingCode,
    message,
    requestId: event.locals.request_id ?? null,
    retryAfterSeconds: (() => {
      const h = response.headers.get("retry-after");
      const n = h ? Number(h) : NaN;
      return Number.isFinite(n) ? n : null;
    })(),
    details:
      response.status === 405 && allow
        ? [{ allowed_methods: allow.split(",").map((m) => m.trim()) }]
        : [],
  });

  // Anything else the callsite sent (upgrade_url, errorId, sentryEventId,
  // validation details) is preserved. The envelope wins on its own fields so
  // the contract is uniform, but no information is dropped.
  const body = { ...(parsed ?? {}), ...envelope };

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, headers });
};

// CSRF origin check. SvelteKit's built-in checkOrigin is disabled in
// svelte.config.js so the OAuth 2.1 machine endpoints can accept the
// cross-origin, form-encoded POSTs the spec requires (they authenticate with
// client_id + PKCE + a one-time code, not the session cookie, so CSRF is not a
// relevant threat for them). This re-applies the identical check SvelteKit does
// (reject a form-content-type mutating request whose Origin does not match this
// site) for every other path, so browser form actions keep the same protection.
const CSRF_EXEMPT_PATHS = new Set([
  "/oauth/token",
  "/oauth/revoke",
  "/oauth/register",
]);

function isFormContentType(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  return (
    type === "application/x-www-form-urlencoded" ||
    type === "multipart/form-data" ||
    type === "text/plain" ||
    // SvelteKit also treats its own progressive-enhancement content type as a
    // form submission for checkOrigin; mirror that so the hand-rolled guard is
    // not laxer than the framework default it replaces.
    type === "application/x-sveltekit-formdata"
  );
}

const csrfHandle: Handle = async ({ event, resolve }) => {
  const { request, url } = event;
  const mutating =
    request.method === "POST" ||
    request.method === "PUT" ||
    request.method === "PATCH" ||
    request.method === "DELETE";
  if (
    mutating &&
    isFormContentType(request) &&
    !CSRF_EXEMPT_PATHS.has(url.pathname) &&
    request.headers.get("origin") !== url.origin
  ) {
    return new Response("Cross-site POST form submissions are forbidden", {
      status: 403,
      headers: { "content-type": "text/plain" },
    });
  }
  return resolve(event);
};

// Per-request auth resolution. Resolves the dashboard browser session
// (JWT cookie / Bearer in Authorization header). Account API key auth
// (`gmk_acct_live_*` / `gmk_cru_live_*`) is handled per-route by the
// helpers in $lib/server/auth, not by this middleware.
const authHandle: Handle = async ({ event, resolve }) => {
  const authHeader = event.request.headers.get("authorization");
  const cookieToken = event.cookies.get("guardian_token");
  // The demo has its own host-only cookie (see lib/server/auth/demo-cookie.ts),
  // so a real session and a demo session can coexist in one browser. A real
  // session always wins: the demo is only consulted when guardian_token and the
  // Authorization header are both absent, so entering the demo can never
  // downgrade someone who is actually logged in.
  const demoToken = event.cookies.get(DEMO_COOKIE);

  const token =
    cookieToken || (authHeader ? authHeader.replace("Bearer ", "") : null) || demoToken || null;
  const usingDemoCookie = !!token && token === demoToken && !cookieToken && !authHeader;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const customer = await getCustomerById(payload.id);
      // The demo cookie may only ever resolve to the demo tenant. Checked
      // against the customer row rather than a claim inside the token, because
      // is_demo in the database is the fact and anything in the payload is
      // self-asserted. Anyone can obtain a demo cookie without authenticating,
      // so it must never be a route to a real account: if a token in that slot
      // resolves to a non-demo customer, the request is anonymous.
      if (usingDemoCookie && customer && !customer.isDemo) {
        event.locals.customer = null;
        event.locals.authKind = null;
        return resolve(event);
      }
      // Reject a token minted before the customer's session_epoch (set on
      // password reset), same as an expired token: a stolen guardian_token
      // stops working the moment the owner resets, instead of living out the
      // stateless 7-day JWT lifetime. isSessionStale fails safe (null epoch or
      // missing iat = allow), so existing sessions are unaffected until reset.
      if (
        customer &&
        customer.status !== "suspended" &&
        !isSessionStale(payload.iat, customer.sessionEpoch)
      ) {
        event.locals.customer = customer;
        event.locals.authKind = "session";
      }
    }
  }

  event.locals.customer ??= null;
  event.locals.authKind ??= null;
  return resolve(event);
};

// Read-only enforcement for the public demo tenant. The demo customer row
// carries is_demo = true (migration 024); the auth handle above resolves it
// onto locals.customer.isDemo. A demo visitor sees the real dashboard but must
// not be able to change anything, so we reject state-changing requests at this
// single chokepoint rather than relying on each endpoint to remember.
//
// The policy (which methods/paths are allowed) lives in the pure, unit-tested
// $lib/server/demo-access module. Two cases need care beyond a plain method
// check: the unauthenticated lead-capture POST is allowed, and a few
// SIDE-EFFECTING GETs (browser redirect flows that write or charge) must be
// blocked even though GET is otherwise the read-only browsing path.
// /api/v1/billing/checkout stays on that blocklist even though it now answers
// 410 to everyone: the entry costs nothing and a route once capable of
// creating Stripe customers does not get removed from a denylist on the
// promise that it stays harmless. auth/logout and auth/verify stay
// reachable: logout clears the demo cookie (the demo's own exit path) and the
// demo customer is seeded email_verified, so verify is a no-op. See
// demo-access.ts.
const demoGuard: Handle = async ({ event, resolve }) => {
  if (event.locals.customer?.isDemo) {
    const disposition = demoDisposition(event.request.method, event.url.pathname);
    if (disposition === "block-get") {
      // Browser navigation (e.g. the upgrade link); bounce to settings rather
      // than dumping a 403 JSON body into the tab.
      return new Response(null, { status: 303, headers: { location: "/settings" } });
    }
    if (disposition === "block-mutation") {
      return json(
        { error: "This is a read-only demo. Sign up to manage your own fleet." },
        { status: 403 },
      );
    }
  }
  return resolve(event);
};

// Security response headers (audit 2026-05-22 §1.6 / catalog T-309).
// The fetch-directive CSP is set via kit.csp (svelte.config.js) as a
// <meta> tag with managed nonces. These are the HEADER-only protections
// that meta CSP cannot express:
//   - X-Frame-Options: DENY  -> clickjacking (frame-ancestors equivalent;
//     meta CSP ignores frame-ancestors, so this is the header form)
//   - X-Content-Type-Options: nosniff -> MIME-sniffing
//   - Referrer-Policy -> don't leak full URLs cross-origin
const securityHeadersHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
};

// sentryHandle() must run before the auth handle so the Sentry SDK
// has a chance to attach request context (URL, method, headers) to
// any error captured downstream. securityHeadersHandle runs last so it
// sets headers on the final response regardless of upstream handlers.
export const handle: Handle = sequence(
  sentryHandle(),
  requestIdHandle,
  apiErrorShapeHandle,
  csrfHandle,
  authHandle,
  demoGuard,
  securityHeadersHandle,
);

// SvelteKit handleServerError: surface a short error ID to the
// client (becomes $page.error.errorId in +error.svelte) while
// shipping the full event to Sentry/GlitchTip for diagnosis.
function shortIdFromEventId(eventId: string | undefined): string {
  if (!eventId) {
    return `err_local_${Math.random().toString(36).slice(2, 10)}`;
  }
  return `err_${eventId.slice(-8)}`;
}

const customServerHandler: HandleServerError = ({ error, event, status }) => {
  const eventId = Sentry.lastEventId();
  const errorId = shortIdFromEventId(eventId);
  const err = error as { message?: string; code?: string } | undefined;
  const message = err?.message ?? "An unexpected error occurred";

  // Under /api/, every thrown error() gets the machine envelope instead of the
  // page-shaped body. Doing it here covers all ~250 inline throws across the 53
  // route files at once, rather than depending on every one of them agreeing
  // with the others forever. The page shape is kept for everything else,
  // because +error.svelte renders it.
  if (isApiPath(event.url.pathname)) {
    return {
      ...apiErrorBody({
        status: status ?? 500,
        message,
        code: err?.code,
        requestId: event.locals.request_id ?? null,
      }),
      errorId,
      sentryEventId: eventId ?? null,
    } as App.Error;
  }

  return {
    message,
    errorId,
    sentryEventId: eventId ?? null,
  };
};

export const handleError: HandleServerError = handleErrorWithSentry(customServerHandler);
