// Paste triage promises that pasted command output is never stored or logged.
// The error tracker is the one path that could carry it: Sentry's Http
// integration captures incoming request bodies (up to 10 KB by default) and
// sends them with any error raised while the request runs. hooks.server.ts
// uses both helpers below, and a test holds the wiring (R4-18).

/** True for a URL on the paste-triage route, whose request body is the user's paste. */
export function isTriageUrl(url: string | undefined): boolean {
  return typeof url === "string" && url.includes("/api/triage/");
}

/** Sentry beforeSend: drop the request body from an event raised on a triage URL. */
export function scrubTriageEvent<E extends { request?: { url?: string; data?: unknown } }>(event: E): E {
  if (event.request && isTriageUrl(event.request.url)) delete event.request.data;
  return event;
}
