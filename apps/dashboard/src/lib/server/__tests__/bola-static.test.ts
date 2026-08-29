import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Static guard against new BOLA regressions. Every +server.ts file under
// a dynamic route segment [id] / [serverId] / [customerId] must either:
//   - contain "customer_id" (so it filters at the SQL layer, or via a
//     helper like requireServerOwnership that does), or
//   - be explicitly exempted below because it has its own auth story
//     (shared-secret crons, admin-email checks, col_-token ingest).
//
// If you hit this test and think your new route doesn't need an
// ownership check, please think again. If it really doesn't (e.g. it's
// a public endpoint or admin-email gated), add it to EXEMPT_PATHS with
// a one-line reason.

const API_ROOT = join(__dirname, "..", "..", "..", "routes", "api");

const EXEMPT_PATHS = new Map<string, string>([
  // Shared-secret bearer token, loops over trusted PG rows.
  ["v1/admin/retention/+server.ts",
    "cron-only, Authorization: Bearer ADMIN_CRON_SECRET"],
  // Admin-only, requires event.locals.customer.email === simon@glassmkr.com.
  ["v1/auth/admin/suspend/[customerId]/+server.ts",
    "admin-email gate inside the handler"],
  // GlitchTip -> Telegram adapter. The dynamic [token] segment IS the
  // auth — it's matched against env GLITCHTIP_WEBHOOK_TOKEN with
  // timingSafeEqual inside the handler. No customer_id concept applies
  // (this is operator infra, not customer data).
  ["v1/webhooks/glitchtip/[token]/+server.ts",
    "shared-secret URL token, timingSafeEqual against GLITCHTIP_WEBHOOK_TOKEN"],
  // The track-record endpoint is list-style, filtered on s.customer_id via
  // a direct SQL JOIN; route directory has no [id] segment so it wouldn't
  // match the dynamic-segment heuristic anyway.
  //
  // The unmatched-path catch-all. Its [...path] segment is the URL that did not
  // match any real route, not an identifier for anything: the handler reads no
  // database, returns the same 404 envelope to every caller authenticated or
  // not, and reflects the path back only inside its own message. There is no
  // object here to authorize access to.
  ["[...path]/+server.ts",
    "unmatched-path 404 envelope; touches no data, identical response for every caller"],
]);

function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(p).isDirectory()) {
      out.push(...walk(p, rel));
    } else if (name === "+server.ts") {
      out.push(rel);
    }
  }
  return out;
}

function hasDynamicSegment(relPath: string): boolean {
  // Match [id], [serverId], [customerId], [warningId], etc.
  return /\[[^\]]+\]/.test(relPath);
}

describe("BOLA static guard", () => {
  const files = walk(API_ROOT);

  // Sanity: we found the route tree.
  it("finds the API tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  const dynamic = files.filter(hasDynamicSegment);

  for (const rel of dynamic) {
    it(`${rel} must enforce ownership (customer_id / col_ token / admin gate)`, () => {
      if (EXEMPT_PATHS.has(rel)) return;
      const body = readFileSync(join(API_ROOT, rel), "utf-8");
      const hasCustomerFilter =
        body.includes("customer_id") ||
        body.includes("requireServerOwnership") ||
        body.includes("requireChannelOwnership") ||
        body.includes("requireAlertOwnership") ||
        body.includes("requireTrendWarningOwnership");
      expect(
        hasCustomerFilter,
        `${rel} has a dynamic segment but no customer_id / ownership helper reference. ` +
        `If this is a shared-secret cron or an admin-email gated endpoint, add it to EXEMPT_PATHS with a note.`,
      ).toBe(true);
    });
  }
});
