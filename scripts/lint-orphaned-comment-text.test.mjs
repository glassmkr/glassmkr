#!/usr/bin/env node
// Known-bad first: the exact shape that shipped on /docs/changelog.
import { findOrphans } from "./lint-orphaned-comment-text.mjs";

let bad = 0;
const ok = (m) => console.log(`[comment-leak-test] ok   ${m}`);
const fail = (m) => { bad++; console.error(`[comment-leak-test] FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : fail(m));

// THE REAL CASE, reduced. The comment quotes a close sequence, so it ends
// early and the rest of the explanation becomes page content.
const LEAKY = `<div class="docs-layout">
  <aside class="sidebar">x</aside>
  <!--
    Cloudflare rewrites addresses in the response.
    \`<!--email_off-->\` is Cloudflare's own documented exemption. It wraps the
    whole article deliberately: this page contains no real addresses, so there
    is nothing here to protect, and wrapping once means future entries are
    covered automatically.
  -->
  <article class="docs-content">y</article>
</div>`;
check(findOrphans(LEAKY).length === 1, "the changelog's leaked comment is detected");

// A normal, well-formed comment followed by markup must NOT trip it.
const CLEAN = `<div>
  <!-- A perfectly ordinary explanation that says something
       across several lines and then closes properly. -->
  <article class="docs-content">y</article>
</div>`;
check(findOrphans(CLEAN).length === 0, "a well-formed comment followed by markup is clean");

// A comment followed by real page copy must not trip it either: one prose line
// is ordinary content, two consecutive orphaned lines are the signature.
const COPY = `<section>
  <!-- section intro -->
  <p>Glassmkr watches bare metal.</p>
</section>`;
check(findOrphans(COPY).length === 0, "a comment followed by markup-wrapped copy is clean");

if (bad) { console.error(`[comment-leak-test] ${bad} failing`); process.exit(1); }
console.log("[comment-leak-test] all fixtures behave as specified");
