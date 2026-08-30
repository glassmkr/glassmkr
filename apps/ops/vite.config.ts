import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Bundle every server dependency into the build (hosted-glue split,
  // 2026-08-30): the ops app deploys as a standalone artifact outside the
  // monorepo checkout, so build/index.js must run with no node_modules.
  ssr: { noExternal: true },
  plugins: [sveltekit()],
});
