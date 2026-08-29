// lint:clickhouse-params (security audit 2026-05-22 §1.4 / catalog T-304).
//
// ClickHouse SQL-injection guard. ClickHouse cannot parameterize column
// IDENTIFIERS (only values, via {name:Type} + query_params), so a small
// amount of identifier interpolation into the SELECT list is unavoidable.
// The rule: every `${...}` inside a ClickHouse `query:` template literal
// must be either
//   (a) a parameterized VALUE -- which means it should NOT be interpolated
//       at all, use query_params; OR
//   (b) a validated/allowlisted IDENTIFIER, marked with a
//       `clickhouse-lint-allow:` comment on the line above, documenting
//       why the interpolated value is injection-safe.
//
// Any other `${...}` in a query template fails CI -- the exact T-304
// "crafted snapshot field reaches dynamic SQL" surface. New ClickHouse
// queries must use query_params for values; new identifier interpolation
// must be allowlisted with a justification a reviewer can check.
//
// Heuristic scanner (not a full TS parser): finds `query:` followed by a
// backtick-delimited template, and flags interpolations in it. Robust
// enough for the handful of call sites; the allowlist comment is the
// escape hatch.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Scan BOTH the server lib and the route handlers. The T-304 surface
// ("a crafted snapshot field reaches dynamic ClickHouse SQL") lives mostly
// in routes/ (the request handlers), which the original lib/server-only scope
// never opened.
const ROOTS = [
  "apps/dashboard/src/lib/server",
  "apps/dashboard/src/routes",
];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (e === "__tests__" || e === "node_modules") continue;
      out.push(...walk(p));
    } else if (e.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

// Core scanner, exported for the companion test. Returns an array of
// 1-based line numbers where a ClickHouse `query:` template interpolates
// `${...}` without a `clickhouse-lint-allow:` marker.
export function scanSource(src) {
  const lines = src.split("\n");
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\bquery:\s*`/.test(lines[i])) continue;
    // Collect the template body until the closing backtick.
    let body = [];
    let j = i;
    let rest = lines[i].slice(lines[i].indexOf("`") + 1);
    while (j < lines.length) {
      const closeIdx = rest.indexOf("`");
      if (closeIdx !== -1) {
        body.push({ ln: j, text: rest.slice(0, closeIdx) });
        break;
      }
      body.push({ ln: j, text: rest });
      j++;
      rest = lines[j] ?? "";
    }
    const hasInterpolation = body.some(({ text }) => text.includes("${"));
    if (!hasInterpolation) continue;

    // The allow marker may live either:
    //   (a) as a SQL `-- clickhouse-lint-allow:` comment inside the
    //       template body (co-located with the SQL it justifies), or
    //   (b) as a JS `// clickhouse-lint-allow:` comment in the 5 lines
    //       preceding the `query:` line (at the call site).
    // A JS comment cannot live inside the template (it would become SQL),
    // so both placements are accepted.
    const templateText = body.map((b) => b.text).join("\n");
    const precedingJs = lines.slice(Math.max(0, i - 5), i).join("\n");
    const allowed =
      /clickhouse-lint-allow:/.test(templateText) ||
      /clickhouse-lint-allow:/.test(precedingJs);
    if (allowed) continue;

    const firstInterp = body.find(({ text }) => text.includes("${"));
    bad.push((firstInterp?.ln ?? i) + 1);
  }
  return bad;
}

// When run directly (not imported by the test), scan the tree.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const files = ROOTS.flatMap((r) => walk(r)).filter((f) => {
    const src = readFileSync(f, "utf8");
    // Match the raw driver AND our @glassmkr/db/clickhouse wrapper, and any
    // clickhouse.<method> call. Without `command`/`insert` here, DDL like
    // `ALTER TABLE ... DELETE` via clickhouse.command() (e.g. the retention
    // cron) was never scanned -- the T-304 gap this fix closes.
    return (
      src.includes("@clickhouse/client") ||
      src.includes("@glassmkr/db/clickhouse") ||
      /clickhouse\s*\.\s*(query|command|insert|exec)/.test(src)
    );
  });

  const violations = [];
  for (const file of files) {
    for (const ln of scanSource(readFileSync(file, "utf8"))) {
      violations.push(
        `${file}:${ln}: interpolation in ClickHouse query template without a` +
          ` 'clickhouse-lint-allow:' justification. Use query_params for VALUES;` +
          ` allowlist + justify validated IDENTIFIERS.`,
      );
    }
  }

  if (violations.length > 0) {
    console.error("[lint:clickhouse-params] violations:");
    for (const v of violations) console.error("  " + v);
    console.error(
      `\n${violations.length} violation(s). ClickHouse values must use ` +
        `query_params ({name:Type}); identifier interpolation must carry a ` +
        `clickhouse-lint-allow: comment explaining why it is injection-safe.`,
    );
    process.exit(1);
  }

  console.log(
    `[lint:clickhouse-params] OK; scanned ${files.length} ClickHouse file(s); ` +
      `all query templates use query_params or allowlisted identifiers.`,
  );
}
