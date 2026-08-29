import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    noExternal: ["@glassmkr/ui", "@glassmkr/db", "@glassmkr/auth"],
  },
  build: {
    rollupOptions: {
      external: ["bcrypt", "pg", "stripe", "node-cron", "@clickhouse/client", "jsonwebtoken"],
    },
  },
});
