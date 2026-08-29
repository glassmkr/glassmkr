import { defineConfig } from "vitest/config";

// Status app vitest config. Exclude Playwright e2e specs which are run with
// playwright test, not vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.svelte-kit/**", "e2e/**"],
  },
});
