#!/usr/bin/env node
// Regenerate .env.example from env.selfhost.example.
//
// Two names for one file. env.selfhost.example is the one the published
// quickstart names (`cp env.selfhost.example .env`), and that string is
// byte-identical-checked across the site, SELF_HOSTING.md and the README, so it
// cannot be renamed without breaking instructions people have already read.
// .env.example is the name a newcomer or a coding agent looks for first.
//
// Copying rather than symlinking because a symlink is awkward on some
// checkouts. Copying is only safe with a check, which launch-integrity.mjs
// provides: if the two drift, the build fails.
import fs from "node:fs";

export const HEADER = `# GENERATED FILE. Do not edit.
#
# This is a copy of env.selfhost.example, which is the file the quickstart
# and the self-hosting guide name, and therefore the one that cannot be
# renamed without breaking published instructions. .env.example exists
# because it is the conventional name a person or an agent looks for first.
#
# Edit env.selfhost.example and run: node scripts/gen-env-example.mjs
# scripts/launch-integrity.mjs fails if the two drift apart.

`;

export function expected() {
  return HEADER + fs.readFileSync("env.selfhost.example", "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.writeFileSync(".env.example", expected());
  console.log("[env-example] regenerated from env.selfhost.example");
}
