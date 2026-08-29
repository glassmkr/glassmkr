#!/usr/bin/env node
// Generates THIRD_PARTY_NOTICES.md from the production dependency graph.
// Run from the monorepo root; CI regenerates this per release (launch gate
// 11) so the notices can never drift from the lockfile.
//
//   pnpm licenses list --prod --json | node scripts/gen-third-party-notices.mjs
//
// The container image distributes node_modules, so every package's own
// LICENSE file ships alongside its code; this file is the human-readable
// index the licenses require us to carry, not a replacement for those texts.

import fs from "node:fs";

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const rows = [];

  // Platform-specific optional packages must not enter the file. A macOS laptop
  // resolves @esbuild/darwin-arm64, @sentry/cli-darwin and fsevents; the Linux
  // CI runner resolves @sentry/cli-linux-x64 and none of those. Generating on
  // one and checking on the other made gate 11 fail on a difference that says
  // nothing about our licensing, which is exactly the kind of check people
  // learn to ignore.
  //
  // The authoritative signal is the package's own manifest: npm uses `os` and
  // `cpu` to declare that a package installs only on certain hosts. Read that
  // rather than pattern-matching names, so a new platform variant is handled
  // without anyone remembering to add it.
  const isPlatformSpecific = (paths) => {
    for (const dir of paths || []) {
      try {
        const m = JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8"));
        if (m.os || m.cpu) return true;
      } catch {
        // Unreadable manifest: treat as portable rather than dropping it
        // silently. A missing entry is a licensing problem; an extra one is not.
      }
    }
    return false;
  };

  for (const [license, pkgs] of Object.entries(data)) {
    for (const p of pkgs) {
      if (isPlatformSpecific(p.paths)) continue;
      rows.push({ name: p.name, versions: (p.versions || []).join(", "), license, homepage: p.homepage || "" });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const counts = {};
  for (const r of rows) counts[r.license] = (counts[r.license] || 0) + 1;

  const out = [];
  out.push("# Third-party notices");
  out.push("");
  out.push("Glassmkr's production dependency tree, generated from the lockfile by");
  out.push("`scripts/gen-third-party-notices.mjs`; do not edit by hand. Each package's");
  out.push("full license text ships with the package itself (in its node_modules");
  out.push("directory, which the container image retains).");
  out.push("");
  out.push("Notes:");
  out.push("- Packages that declare an `os` or `cpu` constraint are omitted, because");
  out.push("  which of them appears depends on the machine that resolved the tree, not");
  out.push("  on what we ship. Their licenses are unaffected and their texts ship with");
  out.push("  the packages if they install.");
  out.push("- `@fontsource/*` packages redistribute fonts under the SIL Open Font");
  out.push("  License 1.1; the OFL texts ship inside those packages and the fonts are");
  out.push("  self-hosted unmodified.");
  out.push("- `caniuse-lite` data is CC-BY-4.0; attribution: caniuse.com.");
  out.push("- `@sentry/cli` (FSL-1.1-MIT) is build-time tooling only; it is not part");
  out.push("  of the distributed application. The runtime `@sentry/*` SDK packages are");
  out.push("  MIT and are inert unless an operator configures a DSN.");
  out.push("");
  out.push("## License summary");
  out.push("");
  for (const [lic, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) out.push(`- ${lic}: ${n}`);
  out.push("");
  out.push("## Packages");
  out.push("");
  out.push("| Package | Version(s) | License |");
  out.push("|---|---|---|");
  for (const r of rows) out.push(`| ${r.name} | ${r.versions} | ${r.license} |`);
  out.push("");

  fs.writeFileSync("THIRD_PARTY_NOTICES.md", out.join("\n"));
  console.log(`[notices] wrote THIRD_PARTY_NOTICES.md: ${rows.length} packages, ${Object.keys(counts).length} licenses`);
});
