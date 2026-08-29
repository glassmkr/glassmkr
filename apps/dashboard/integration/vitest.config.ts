import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(__dirname, "..");

export default defineConfig({
  test: {
    include: ["integration/**/*.test.ts"],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      $lib: path.resolve(root, "src/lib"),
      $app: path.resolve(root, "src"),
    },
  },
});
