// The paste-triage tools are all a connector reviewer or user sees of
// Glassmkr, and the plugin guidelines forbid advertising pricing, plans,
// trials or promotions there. The listing copy has its own check
// (integrations/ai-assistants/scripts/validate-openai-plugin.mjs), and the
// instructions, tool descriptions, capture and setup results are checked at
// runtime in their own tests, but nothing covered the rest of this server:
// finding text, notes, the fix-workflow rewrites, error messages. This reads
// every string literal in the server code (not comments, not tests), so upsell
// text cannot reach a tool result from anywhere in it. The website may state
// the hosted node cap; this code may not.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SRC = join(HERE, "..", "..", "..", "..");
const SCANNED_DIRS = [
  join(DASHBOARD_SRC, "lib", "server", "triage"),
  join(DASHBOARD_SRC, "routes", "api", "triage", "mcp"),
];

// Pricing, plan, trial and node-cap words: the listing check's list plus the
// sibling runtime tests' (tier, billing, paid).
const UPSELL =
  /\b(?:pric(?:e|es|ed|ing)|free|trials?|plans?|tiers?|upgrades?|discounts?|subscri(?:be|bed|bes|ption|ptions)|billing|billed|paid|promo(?:s|tion|tions)?|unlimited)\b|\bnode[- ](?:cap|limit)s?\b|\b\d+[- ]?nodes?\b/gi;

// "Plan" as a verb in remediation text: "plan its replacement", "plan
// preventive replacement" (a fix workflow's "#" comment marker can sit between
// the words). Nothing else is exempt: a new hit gets reworded, or an exemption
// here with its reason.
const VERB_PLAN = /\bplan(?:\s+its|\s+preventive)?[\s#]+replacement\b/gi;

function upsellWords(text: string): string[] {
  return [...text.replace(VERB_PLAN, "").matchAll(UPSELL)].map((m) => m[0]);
}

/** Every string literal and template-literal chunk in a TypeScript source, with its line. */
function stringLiterals(source: string, fileName: string): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: Array<{ line: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...serverFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function findings(source: string, fileName: string): string[] {
  return stringLiterals(source, fileName).flatMap(({ line, text }) =>
    upsellWords(text).map((w) => `${fileName}:${line}: "${w}"`),
  );
}

describe("paste-triage server code carries no upsell text", () => {
  it("the matcher catches a planted word and ignores comments, regexes and the verb 'plan'", () => {
    const planted = [
      'const a = "Hosted accounts are free up to 10 nodes.";',
      "const b = `Start a ${days}-day trial`;",
      'const c = ["Upgrade to the Pro plan", "x"];',
      'const d = "See pricing at https://glassmkr.com/pricing";',
    ];
    for (const src of planted) expect(findings(src, "planted.ts"), src).not.toEqual([]);

    const clean = [
      "// free text and plans live in comments\nconst a = 1;",
      "const re = /Free Space\\s*:\\s*(\\d+)/;",
      'const b = "identify the DIMM and plan its replacement.";',
      'const c = "#    between readings, plan preventive\\n#    replacement.";',
      'const d = "Sign in or sign up at https://app.glassmkr.com";',
    ];
    for (const src of clean) expect(findings(src, "clean.ts"), src).toEqual([]);
  });

  it("no string literal in the triage server or its route names a price, plan, trial or node cap", () => {
    const files = SCANNED_DIRS.flatMap(serverFiles);
    const names = files.map((f) => relative(DASHBOARD_SRC, f));
    // A wrong path must not pass by scanning nothing.
    for (const must of [
      "lib/server/triage/mcp-server.ts",
      "lib/server/triage/analyze.ts",
      "lib/server/triage/setup.ts",
      "lib/server/triage/capture.ts",
      "lib/server/triage/parsers/smartctl.ts",
      "routes/api/triage/mcp/+server.ts",
    ]) {
      expect(names).toContain(must);
    }
    const hits = files.flatMap((f) => findings(readFileSync(f, "utf8"), relative(DASHBOARD_SRC, f)));
    expect(hits).toEqual([]);
  });
});
