#!/usr/bin/env node
//
// Test the ClickHouse-params lint scanner (security audit §1.4 / Decision
// 10: every new CI gate ships with a known-bad fixture proving it catches
// a real-world equivalent). Standalone, no test framework, like
// lint-account-id-constraint.test.mjs. Exits non-zero on mismatch.

import { scanSource } from "./lint-clickhouse-params.mjs";

const cases = [
  {
    label: "value interpolation (the T-304 injection bug) -> FLAGGED",
    src: "await clickhouse.query({ query: `SELECT * FROM t WHERE id = '${userInput}'` });",
    expectViolation: true,
  },
  {
    label: "multi-line value interpolation -> FLAGGED",
    src: [
      "await clickhouse.query({",
      "  query: `",
      "    SELECT * FROM snapshots",
      "    WHERE server_id = '${serverId}'",
      "  `,",
      "});",
    ].join("\n"),
    expectViolation: true,
  },
  {
    label: "parameterized values, no interpolation -> OK",
    src: [
      "await clickhouse.query({",
      "  query: `SELECT * FROM t WHERE id = {id:String}`,",
      "  query_params: { id },",
      "});",
    ].join("\n"),
    expectViolation: false,
  },
  {
    label: "identifier interpolation WITH SQL allow-marker -> OK",
    src: [
      "await clickhouse.query({",
      "  query: `",
      "    -- clickhouse-lint-allow: col is z.enum-validated",
      "    SELECT ${projection} FROM snapshots",
      "  `,",
      "});",
    ].join("\n"),
    expectViolation: false,
  },
  {
    label: "identifier interpolation WITH preceding JS allow-marker -> OK",
    src: [
      "// clickhouse-lint-allow: column regex-validated above",
      "const r = await clickhouse.query({",
      "  query: `SELECT ${col} AS v FROM snapshots`,",
      "});",
    ].join("\n"),
    expectViolation: false,
  },
  {
    label: "identifier interpolation WITHOUT any marker -> FLAGGED",
    src: "await clickhouse.query({ query: `SELECT ${col} FROM snapshots` });",
    expectViolation: true,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = scanSource(c.src).length > 0;
  const ok = got === c.expectViolation;
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(
      `FAIL: ${c.label}\n  expected violation=${c.expectViolation}, got=${got}`,
    );
  }
}

console.log(`[lint:clickhouse-params:test] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
