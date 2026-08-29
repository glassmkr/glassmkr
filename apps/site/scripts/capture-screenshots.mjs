#!/usr/bin/env node
/**
 * Capture homepage showcase components as PNGs for the Crucible README.
 *
 * Why this exists: the Crucible README references three screenshots
 * (alerts.png, hardware.png, overview.png) hosted at glassmkr.com/screenshots/.
 * They were rendered from an older dashboard UI in April. The marketing
 * homepage now has hand-crafted showcase components that look better and
 * are kept in sync with the product narrative. This script renders those
 * components headlessly and writes the PNGs to apps/site/static/screenshots/.
 *
 * Usage (from apps/site):
 *   pnpm capture:screenshots
 *
 * Internals: spawns `vite dev`, waits for it to listen, navigates Playwright
 * to /__capture/<name>, screenshots #capture-root, writes the file. Kills
 * the dev server on exit.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(__dirname, "..");
const OUT_DIR = join(SITE_ROOT, "static", "screenshots");
const PORT = 3009; // avoid clashing with normal dev (3001) and preview ports

// Map: output filename ↔ showcase identifier on the /__capture/<name> route.
const CAPTURES = [
  { name: "alert", out: "alerts.png" },
  { name: "storage", out: "hardware.png" },
  { name: "overview", out: "overview.png" },
];

function waitForPort(url, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { method: "GET" });
        if (res.ok || res.status < 500) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timeout waiting for ${url}`));
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const vite = spawn("pnpm", ["vite", "dev", "--port", String(PORT), "--strictPort"], {
    cwd: SITE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
  });

  // Forward dev server output (helpful when debugging) but don't block.
  vite.stdout.on("data", (b) => process.stdout.write(`[vite] ${b}`));
  vite.stderr.on("data", (b) => process.stderr.write(`[vite] ${b}`));

  const cleanup = () => {
    try {
      vite.kill("SIGTERM");
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  console.log(`[capture] waiting for vite on :${PORT}…`);
  await waitForPort(`http://localhost:${PORT}/__capture/alert`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2, // retina-quality PNGs
  });
  const pg = await ctx.newPage();

  for (const cap of CAPTURES) {
    const url = `http://localhost:${PORT}/__capture/${cap.name}`;
    console.log(`[capture] ${cap.name} → ${cap.out}`);
    await pg.goto(url, { waitUntil: "networkidle" });
    const el = await pg.$("#capture-root");
    if (!el) throw new Error(`#capture-root not found at ${url}`);
    await el.screenshot({ path: join(OUT_DIR, cap.out), omitBackground: false });
  }

  await browser.close();
  cleanup();
  console.log(`[capture] wrote ${CAPTURES.length} files to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("[capture] fatal:", err);
  process.exit(1);
});
