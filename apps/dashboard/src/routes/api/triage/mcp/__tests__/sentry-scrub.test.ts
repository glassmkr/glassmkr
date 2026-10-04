// The privacy page and /docs/ai-assistants promise that pasted output is never
// stored or logged. On the error-reporting path the only guard was an inline
// beforeSend closure in hooks.server.ts that nothing could import or test, so
// dropping it (for example in a move to instrumentation.server.ts) left every
// gate green while the paste rode along with the next error event (R4-18).

import { describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => {
  process.env.SENTRY_DSN = "https://public@errors.example.invalid/1";
  return { init: vi.fn(), http: vi.fn() };
});
// httpIntegration stays the real one, wrapped so its options can be read: a
// bare httpIntegration() still registers an integration named "Http" and
// captures every request body (R5-17).
vi.mock("@sentry/sveltekit", async (importOriginal) => {
  const orig = await importOriginal<{ httpIntegration: (options?: unknown) => unknown }>();
  sentry.http.mockImplementation((options?: unknown) => orig.httpIntegration(options));
  return { ...orig, init: sentry.init, httpIntegration: sentry.http };
});
vi.mock("$lib/server/watchdog-scheduler", () => ({ startWatchdog: () => {} }));
vi.mock("$lib/server/trend-warnings/scheduler", () => ({ startTrendWarnings: () => {} }));
vi.mock("$lib/server/billing/enforcement-scheduler", () => ({ startBillingEnforcement: () => {} }));
vi.mock("$lib/server/billing/email-reminders-scheduler", () => ({ startEmailReminders: () => {} }));
vi.mock("$lib/server/account/key-expiry-scheduler", () => ({ startKeyExpiry: () => {} }));
vi.mock("$lib/server/endoflife/scheduler", () => ({ startEndoflifeSync: () => {} }));
vi.mock("$lib/server/graceful-shutdown", () => ({ registerGracefulShutdown: () => {} }));
vi.mock("@glassmkr/auth", () => ({ verifyToken: () => null, getCustomerById: async () => null }));

import { isTriageUrl, scrubTriageEvent } from "$lib/server/triage/sentry-scrub";

const PASTE = "SMART overall-health self-assessment test result: FAILED! host=db01.internal";

function event(url: string) {
  return { request: { url, method: "POST", data: JSON.stringify({ params: { arguments: { output: PASTE } } }) } };
}

describe("the triage request body never reaches the error tracker (R4-18)", () => {
  it("scrubTriageEvent drops the body on the triage route and keeps it elsewhere", () => {
    expect(scrubTriageEvent(event("https://app.glassmkr.com/api/triage/mcp")).request.data).toBeUndefined();
    expect(scrubTriageEvent(event("http://127.0.0.1:3000/api/triage/mcp?x=1")).request.data).toBeUndefined();
    expect(scrubTriageEvent(event("https://app.glassmkr.com/api/v1/servers")).request.data).toContain("FAILED");
    expect(scrubTriageEvent({})).toEqual({});
    expect(isTriageUrl("/api/triage/mcp")).toBe(true);
    expect(isTriageUrl("/api/v1/ingest")).toBe(false);
    expect(isTriageUrl(undefined)).toBe(false);
  });

  it("hooks.server.ts wires it into Sentry.init, and skips capturing the body at all", async () => {
    await import("../../../../../hooks.server");
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0][0];
    const sent = await options.beforeSend(event("https://app.glassmkr.com/api/triage/mcp"), {});
    expect(sent.request.data).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("db01.internal");
    const other = await options.beforeSend(event("https://app.glassmkr.com/api/v1/servers"), {});
    expect(other.request.data).toContain("FAILED");
    // Second layer: the Http integration does not read the triage body.
    expect((options.integrations as Array<{ name: string }>).map((i) => i.name)).toContain("Http");
    expect(sentry.http).toHaveBeenCalledTimes(1);
    const ignore = (sentry.http.mock.calls[0][0] as { ignoreIncomingRequestBody?: (url: string) => boolean } | undefined)
      ?.ignoreIncomingRequestBody;
    expect(typeof ignore).toBe("function");
    expect(ignore!("https://app.glassmkr.com/api/triage/mcp")).toBe(true);
    expect(ignore!("/api/triage/mcp")).toBe(true);
    expect(ignore!("/api/v1/ingest")).toBe(false);
  });
});
