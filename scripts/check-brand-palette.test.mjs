#!/usr/bin/env node
// Known-bad fixtures for the brand-palette guard. Written from the exact things
// the redesign retired, so a broken matcher fails here instead of passing prod.
import { retiredBrandHits, priorityBrandHits, transitionAllHits, stripComments } from "./check-brand-palette.mjs";
let bad = 0;
const ok = (c, m) => (c ? console.log(`[brand-palette-test] ok   ${m}`) : (bad++, console.error(`[brand-palette-test] FAIL ${m}`)));

// THE RETIRED LITERALS must be caught.
ok(retiredBrandHits(".x{color:#e1843b}").length > 0, "catches #e1843b");
ok(retiredBrandHits(".x{color:#F5A623}").length > 0, "catches #F5A623 (case-insensitive)");
ok(retiredBrandHits(".x{fill:#D4820A}").length > 0, "catches the retired logo amber #D4820A");
ok(retiredBrandHits("border:1px solid rgba(245, 166, 35, 0.2)").length > 0, "catches the #f5a623 rgba form");
ok(retiredBrandHits('const c="rgba(245,166,35,0.9)"').length > 0, "catches the bare canvas triple");
// The new brand must NOT be flagged.
ok(retiredBrandHits(".x{color:#ff6b35}").length === 0, "allows the new brand #ff6b35");
ok(retiredBrandHits("--g-brand: var(--g-brand)").length === 0, "allows brand tokens");
// History in a comment is allowed.
ok(retiredBrandHits("/* raised from #e1843b on 2026-08-27 */").length === 0, "ignores a retired value in a block comment");
ok(retiredBrandHits("// was #f5a623 before the redesign\n.x{color:var(--g-brand)}").length === 0, "ignores a retired value in a line comment");

// Priority painted with brand is the 4.4 collision.
ok(priorityBrandHits('color: "var(--accent)",').length > 0, "catches a priority color mapped to var(--accent)");
ok(priorityBrandHits(".priority-p3 { color: var(--g-brand); }").length > 0, "catches a priority selector using the brand token");
ok(priorityBrandHits('color: "var(--g-priority-p3)",').length === 0, "allows the decoupled priority token");
ok(priorityBrandHits(".btn-primary { color: var(--g-brand); }").length === 0, "allows brand on a non-priority element");

// transition: all is banned.
ok(transitionAllHits(".x{transition: all 0.2s}").length > 0, "catches transition: all");
ok(transitionAllHits(".x{transition: color 0.2s, border-color 0.2s}").length === 0, "allows enumerated transitions");

if (bad) { console.error(`[brand-palette-test] ${bad} failing`); process.exit(1); }
console.log("[brand-palette-test] all fixtures behave as specified");
