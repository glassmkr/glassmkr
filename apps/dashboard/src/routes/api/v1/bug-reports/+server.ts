// scope: public
// POST /api/v1/bug-reports
//
// Receives a user-submitted bug report from the BugReportButton
// modal and forwards it to GlitchTip (Sentry-compatible) as a
// captured event so it lands in the same triage queue as auto-
// captured runtime errors. Same alert routing applies (GlitchTip
// → internal Telegram/Slack rule).
//
// Authentication: NOT required. A casual visitor must be able to
// report a bug. The endpoint is rate-limited per-IP (10 reports
// per hour per IP) to keep it from becoming an abuse vector.
//
// Sentry SDK init lives in hooks.server.ts; when SENTRY_DSN is
// unset the SDK no-ops and we just log the report to the journal
// so it isn't silently dropped during local dev or before
// GlitchTip is stood up.

import { json } from "@sveltejs/kit";
import { getSourceIp } from "$lib/server/auth/source-ip";
import { z } from "zod";
import * as Sentry from "@sentry/sveltekit";
import type { RequestHandler } from "./$types";

const bugReportSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  email: z.string().email().nullable().optional(),
  errorId: z.string().max(64).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
});

// Minimal in-memory IP bucket. Acceptable here because the
// endpoint is low-volume and the limit is generous (10/h). A
// single Dashboard node restart resets state, which is fine — we
// don't need persistence to deter spam at this scale.
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 10;

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || now > b.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_LIMIT) return false;
  b.count += 1;
  return true;
}

// tier: free (unauthenticated bug-report submission; any visitor
// can report a bug. Rate-limited 10/hour/IP. No Pro-gate.)
export const POST: RequestHandler = async (event) => {
  const { request, locals } = event;
  // Rate limit before parsing to keep abuse cheap. getSourceIp, not
  // getClientAddress: the latter is the nginx loopback peer (launch
  // hardening, 2026-08-24).
  const ip = getSourceIp(event);
  if (!rateLimitOk(ip)) {
    return json(
      { ok: false, message: "Too many reports. Try again in an hour." },
      { status: 429 },
    );
  }

  let body: z.infer<typeof bugReportSchema>;
  try {
    const raw = await request.json();
    body = bugReportSchema.parse(raw);
  } catch (err) {
    return json(
      { ok: false, message: "Invalid bug report payload." },
      { status: 400 },
    );
  }

  // Build the Sentry event. Use captureMessage so the report
  // shows up as an event in GlitchTip even when no underlying
  // error exists (e.g., user reports a UX issue from the floating
  // button without hitting an error page first).
  const customer = locals.customer;
  const eventId = Sentry.captureMessage(`Bug report: ${body.title}`, {
    level: "info",
    tags: {
      kind: "bug-report",
      ...(body.errorId ? { related_error: body.errorId } : {}),
    },
    extra: {
      description: body.description,
      reporter_email: body.email ?? null,
      related_error_id: body.errorId ?? null,
      page_url: body.url ?? null,
      user_agent: body.userAgent ?? null,
      reporter_customer_id: customer?.id ?? null,
      reporter_plan: customer?.plan ?? null,
    },
    user: customer
      ? { id: customer.id, email: customer.email }
      : body.email
        ? { email: body.email }
        : undefined,
  });

  // Always log to the journal so the report is not silently
  // dropped when SENTRY_DSN is unset (local dev, pre-GlitchTip
  // prod). The journal is grep-able by the same operator who
  // would otherwise read GlitchTip.
  console.log(
    `[bug-report] eventId=${eventId || "(no-sentry)"} ip=${ip} ` +
      `customer=${customer?.id ?? "anon"} relatedError=${body.errorId ?? "-"} ` +
      `title=${JSON.stringify(body.title)}`,
  );

  return json({ ok: true, eventId: eventId || null });
};
