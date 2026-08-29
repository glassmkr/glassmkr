// Client-side hooks. Sentry-compatible error tracking (we run
// self-hosted GlitchTip, which speaks the Sentry protocol, on
// glitchtip.glassmkr.com; see docs/internal/specs/error-tracking.md).
//
// The SDK is a no-op when PUBLIC_SENTRY_DSN is unset, so this file
// is safe to ship and merge before the GlitchTip instance exists.
// Local dev stays clean; prod activates the moment the env var is
// set on the Dashboard node.
//
// handleErrorWithSentry wraps SvelteKit's handleError hook so any
// unhandled client error is captured AND a short `errorId` is
// returned to the +error.svelte boundary for the user to reference
// in a bug report. The short ID is the last 8 chars of the Sentry
// event UUID; the full UUID is searchable in the GlitchTip admin.

import type { HandleClientError } from "@sveltejs/kit";
import { handleErrorWithSentry } from "@sentry/sveltekit";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";

if (env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN,
    release: env.PUBLIC_GIT_SHA || undefined,
    environment: import.meta.env.MODE,
    // No session replay. No PII capture. We only want stack traces
    // + breadcrumbs + the user-provided bug report message.
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

function shortIdFromEventId(eventId: string | undefined): string {
  if (!eventId) {
    // Sentry was not initialized or didn't return an ID. Mint a
    // local one so the user still has a reference; we won't be
    // able to look it up in GlitchTip but at least support can
    // tie it to a timestamp in the Dashboard journal.
    return `err_local_${Math.random().toString(36).slice(2, 10)}`;
  }
  return `err_${eventId.slice(-8)}`;
}

const customHandler: HandleClientError = ({ error }) => {
  const eventId = Sentry.lastEventId();
  const errorId = shortIdFromEventId(eventId);
  const err = error as { message?: string } | undefined;
  return {
    message: err?.message ?? "An unexpected error occurred",
    errorId,
    sentryEventId: eventId ?? null,
  };
};

export const handleError = handleErrorWithSentry(customHandler);
