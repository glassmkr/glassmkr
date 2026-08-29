#!/usr/bin/env node
//
// Test the BOLA exempt-marker recogniser. Standalone — no test
// framework dependency to keep the lint scripts independent of the
// monorepo's app-level vitest setup. Run via `pnpm test:lint` or
// `node scripts/lint-account-id-constraint.test.mjs` directly.
//
// Exits non-zero on any case mismatch.

import { BOLA_EXEMPT_RE } from "./lint-account-id-constraint.mjs";

const cases = [
  // accepted
  { input: "// bola-exempt: rationale",        accept: true,  label: "canonical lowercase, hyphen" },
  { input: "// BOLA-exempt: rationale",        accept: true,  label: "uppercase prefix" },
  { input: "// BOLA-safe: rationale",          accept: true,  label: "readable BOLA-safe (PR #73 friction)" },
  { input: "// bola-safe: rationale",          accept: true,  label: "lowercase safe variant" },
  { input: "// bola_exempt: rationale",        accept: true,  label: "underscore separator" },
  { input: "// BOLA_SAFE: rationale",          accept: true,  label: "uppercase + underscore + safe" },
  { input: "/* bola-exempt: rationale */",     accept: true,  label: "block comment" },
  { input: "-- bola-exempt: rationale",        accept: true,  label: "SQL line comment" },
  { input: "  // BOLA-safe : rationale",       accept: true,  label: "space before colon" },

  // rejected
  { input: "// bolaexempt: rationale",         accept: false, label: "no separator → typo" },
  { input: "// bolasafe: rationale",           accept: false, label: "no separator (safe variant)" },
  { input: "// bola-exempted: rationale",      accept: false, label: "suffix typo" },
  { input: "// bola-secure: rationale",        accept: false, label: "wrong word" },
  { input: "// bolaxsafe: rationale",          accept: false, label: "garbled separator" },
  { input: "// just a regular comment",        accept: false, label: "no marker at all" },
  { input: "// references bola-exempt in prose, no colon", accept: false, label: "prose mention without colon" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = BOLA_EXEMPT_RE.test(c.input);
  const ok = got === c.accept;
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${c.label}`);
    console.error(`        input:    ${c.input}`);
    console.error(`        expected: ${c.accept ? "accept" : "reject"}`);
    console.error(`        got:      ${got ? "accept" : "reject"}`);
  }
}

if (fail === 0) {
  console.log(`OK: ${pass}/${pass + fail} BOLA exempt-marker cases pass.`);
  process.exit(0);
}
console.error(`\nFAILED: ${fail}/${pass + fail} cases.`);
process.exit(1);
