// Lint test: every +server.ts route file under apps/dashboard/src/routes/api/
// must declare a `// scope: <level>` marker as one of its first 20 lines.
//
// Per CC_UNIFY_API_AUTH_2026-05-15.md Spec B and the endpoint inventory at
// ~/Documents/Glassmkr/validation-findings/UNIFY_API_AUTH_ENDPOINT_INVENTORY.md.
//
// The marker is the contract that future enforcement reads from:
//   - read / write / admin   : hierarchical scope; `requireScopeLevel`
//                              enforces; gated by `requireProGatedAuth` or
//                              inline pattern.
//   - public                 : unauthenticated; no auth at all (health
//                              probes, login/register, webhooks, version).
//   - session-only           : session-only; acct_key is deliberately
//                              refused (logout, password-verify,
//                              resend-verification).
//   - internal-secret        : cron-style ADMIN_CRON_SECRET; not part of
//                              the customer API-key system.
//   - cru-key-only           : `gmk_cru_*` collector keys; not part of
//                              the account-key system. Currently only
//                              applies to /api/v1/ingest.
//
// Failure mode: any route added without a `// scope:` marker fails CI.
// The intent is to make scope classification a required step when
// adding any new endpoint.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = dirname(__dirname); // apps/dashboard/src/routes/api/

const VALID_SCOPES = [
  "read",
  "write",
  "admin",
  "public",
  "session-only",
  "internal-secret",
  "cru-key-only",
] as const;

const MARKER_RE = new RegExp(`^// scope: (${VALID_SCOPES.join("|")})$`);

function findRouteFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Don't recurse into __tests__ — those are not route files.
      if (entry.name === "__tests__") continue;
      findRouteFiles(full, out);
    } else if (entry.name === "+server.ts") {
      out.push(full);
    }
  }
}

const routeFiles: string[] = [];
findRouteFiles(API_ROOT, routeFiles);

describe("API route scope-marker lint (Spec B)", () => {
  it("finds a plausible number of route files (sanity check)", () => {
    // Sanity guard: if this drops to < 30, the test runner probably
    // missed the recursion or the routes layout changed. Catches the
    // "lint says everything's fine because it saw zero files" failure
    // mode.
    expect(routeFiles.length).toBeGreaterThanOrEqual(30);
  });

  it.each(routeFiles.map((f) => [relative(API_ROOT, f), f]))(
    "route %s declares a valid // scope: marker",
    (_label, file) => {
      const lines = readFileSync(file, "utf-8").split("\n").slice(0, 20);
      const found = lines.find((line) => MARKER_RE.test(line.trim()));
      expect(
        found,
        `expected a "// scope: <level>" comment (one of: ${VALID_SCOPES.join(", ")}) in the first 20 lines of ${file}. Add a marker that matches the inventory at ~/Documents/Glassmkr/validation-findings/UNIFY_API_AUTH_ENDPOINT_INVENTORY.md.`,
      ).toBeDefined();
    },
  );
});
