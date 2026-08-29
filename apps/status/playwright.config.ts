import { defineConfig } from "@playwright/test";

// Smoke test for the live status page. Configurable target so we can also run
// against a local preview if needed: STATUS_URL=http://localhost:3005 npx playwright test
const baseURL = process.env.STATUS_URL || "https://status.glassmkr.com";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: {
    baseURL,
    headless: true,
  },
});
