#!/usr/bin/env node
// Known-bad fixtures for the plan-language gate, written from the exact
// strings that were live on the dashboard while the docs said no paid tier
// exists.
import { findUpsells } from "./lint-plan-language.mjs";

let bad = 0;
const check = (c, m) => (c ? console.log(`[plan-language-test] ok   ${m}`)
  : (bad++, console.error(`[plan-language-test] FAIL ${m}`)));

// THE SHIPPED STRINGS.
check(findUpsells('<a href="/api/v1/billing/checkout" class="btn">Upgrade to Pro</a>').length > 0,
  'catches the settings "Upgrade to Pro" button');
check(findUpsells("<h2>Pro plan required</h2>").length > 0,
  'catches the audit page "Pro plan required" card');
check(findUpsells("<h3>Trend warnings for hardware are a Pro feature</h3>").length > 0,
  "catches the trend-warnings upsell");
check(findUpsells('"The account audit log is a Pro feature on the hosted service."').length > 0,
  "catches the 402 body string");

// Must NOT fire on the things that legitimately remain.
check(findUpsells("<h2>Pro (legacy)</h2>").length === 0,
  "allows the legacy plan label");
check(findUpsells("<strong>Cancel your Glassmkr Pro subscription?</strong>").length === 0,
  "allows the legacy-subscriber cancel flow");
check(findUpsells("// Permanent purge is NOT a Pro feature. The plan gates node count").length === 0,
  "ignores comments");
check(findUpsells("<p>This page used to document which API capabilities required the paid Pro plan.</p>").length === 0,
  "allows the historical description on the tier-gating docs page");

// --- Round two: the strings the FIRST version of this gate walked past ------
check(findUpsells('<dd>One free analysis per server; unlimited on the paid tier.</dd>').length > 0,
  'catches "unlimited on the paid tier" (was live on settings)');
check(findUpsells('let wantsPro = $derived($page.url.searchParams.get("plan") === "pro");').length > 0,
  "catches the register ?plan=pro parameter");
check(findUpsells('<a href="/api/v1/billing/checkout" class="btn">x</a>').length > 0,
  "catches a link into checkout");
check(findUpsells('goto("/api/v1/billing/checkout");').length > 0,
  "catches a goto into checkout");
// The marker IS a comment: the first version stripped comments before checking
// for it, so it could never fire, and this fixture blessed the blind spot.
check(findUpsells("// tier: pro\nexport const GET = 1;").length > 0,
  "catches a tier: pro route marker, which only ever exists as a comment");
check(findUpsells("// the route was tier: pro until the pivot").length === 0,
  "does not fire on prose that mentions the old marker mid-sentence");
check(findUpsells('<p>By subscribing, you request immediate access.</p>').length > 0,
  'catches the pre-subscription consent notice');

// Things that must stay allowed.
check(findUpsells('"/api/v1/billing/checkout", // demo blocklist entry').length === 0,
  "allows the demo blocklist naming the route");
check(findUpsells('<td>Paid tier</td><td>Business: $4.50/node/month</td>').length === 0,
  "allows a competitor's paid tier in a comparison row");
check(findUpsells('<p>Hosted has no paid tier and no new subscriptions can be created.</p>').length === 0,
  "allows the denial");

// --- Round three (Codex 2026-08-29 #16): the analyze endpoint's retired ---
// upsell survived as a dead branch whose SPLIT STRING ("Upgrade for " +
// "unlimited analysis") no phrase pattern could see. The response FIELD is the
// stable thing every upsell body carried, and no active surface may emit it.
check(findUpsells('return json({ error: msg, upgrade_url: "/settings" }, { status: 403 });').length > 0,
  "catches a handler emitting an upgrade_url field");
check(findUpsells("// Anything else the callsite sent (upgrade_url, errorId) passes through").length === 0,
  "does not fire on the hooks comment that names the field generically");

if (bad) { console.error(`[plan-language-test] ${bad} failing`); process.exit(1); }
console.log("[plan-language-test] all fixtures behave as specified");
