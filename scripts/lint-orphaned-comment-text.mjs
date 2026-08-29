#!/usr/bin/env node
// An authored HTML comment must not end before its author meant it to.
//
// WHAT THIS CAUGHT
//
// /docs/changelog carried a long explanatory comment about Cloudflare's
// email_off marker, and it quoted that marker in full, close sequence and all.
// An HTML comment ends at the FIRST close sequence the parser meets, so the
// comment ended in the middle of its own explanation. The remaining 974
// characters became a live, non-blank text node, a direct child of the flex
// container .docs-layout.
//
// A flex container turns a run of text into an anonymous flex item. That item
// took 684 of the 864 available pixels and squeezed .docs-content, which is
// flex: 1 1 0% with min-width: 0, to ZERO width. Every changelog entry rendered
// one character per line down the right edge of the page, underneath several
// paragraphs of internal engineering notes, in public.
//
// Two things went wrong and only one of them is about layout. Internal comments
// are written on the assumption that they are not published. This check is
// about that assumption.
//
// HOW IT DETECTS IT
//
// After every comment's close sequence, look at what follows. If the next
// non-empty lines are indented prose rather than markup or a Svelte expression,
// the comment almost certainly ended early and the rest of it is now content.
// Prose here means: no tag opener, no brace expression, and words rather than
// attributes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["apps/site/src", "apps/dashboard/src", "packages/ui/src"];

/** Pure, exported for the fixture test. Returns [{line, sample}] for one file. */
export function findOrphans(src) {
  const out = [];
  const re = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(src))) {
    const after = src.slice(m.index + m[0].length);
    const lines = after.split("\n").slice(0, 6).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const prosey = (l) =>
      !l.startsWith("<") &&
      !l.startsWith("{") &&
      !l.startsWith("}") &&
      !l.includes("=") &&
      /[a-z]{3,}\s+[a-z]{3,}/i.test(l) && // at least two words
      l.length > 20;
    // Two consecutive prose lines immediately after a comment closes is the
    // signature. One alone is ordinary page copy.
    if (prosey(lines[0]) && prosey(lines[1])) {
      out.push({
        line: src.slice(0, m.index).split("\n").length,
        sample: lines[0].slice(0, 70),
      });
    }
  }
  return out;
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...walk(p)); }
    else if (e.name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [];
  for (const dir of SCAN) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, "utf8");
      for (const o of findOrphans(src)) {
        problems.push(`${path.relative(ROOT, file)}:${o.line}  "${o.sample}..."`);
      }
    }
  }
  if (problems.length) {
    console.error(`[lint:comment-leak] ${problems.length} comment(s) appear to end early, leaking their remaining text into the page:`);
    for (const p of problems) console.error("  " + p);
    console.error(
      "\nAn HTML comment ends at the FIRST close sequence. If the comment quotes\n" +
      "one, it ends there and the rest becomes visible page content. Refer to a\n" +
      "marker by name instead of writing it out.",
    );
    process.exit(1);
  }
  console.log("[lint:comment-leak] OK; no authored comment ends before its text does");
}
