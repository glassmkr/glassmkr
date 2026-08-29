import { test, expect } from "@playwright/test";

// Smoke test: ensure the public status page renders with the overall banner,
// shows the monitored services, and is HTTPS-served.
//
// Service catalogue used to include Bench (bench.glassmkr.com) but Bench was
// retired 2026-05-22 (see PR #207 + npm deprecation of @glassmkr/bench-*).
// Status page service catalogue at apps/status/src/lib/services.ts is the
// source of truth; this test stays in lockstep with it.

test("status page renders overall banner + service cards", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();

  // Overall banner: one of the three known labels
  const overall = page.locator(".overall h1");
  await expect(overall).toBeVisible();
  await expect(overall).toHaveText(/All systems operational|Partial outage|Major outage/);

  // Service catalogue: Dashboard, glassmkr.com
  const services = page.locator(".service .name");
  await expect(services).toHaveCount(2);
  await expect(services.nth(0)).toContainText("Dashboard");
  await expect(services.nth(1)).toContainText("glassmkr.com");

  // Footer attribution
  await expect(page.locator(".status-footer")).toContainText("Crucible");
});

test("public URL is HTTPS and returns 200", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const ctype = res.headers()["content-type"] ?? "";
  expect(ctype).toContain("text/html");
});
