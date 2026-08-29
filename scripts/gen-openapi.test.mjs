#!/usr/bin/env node
// Known-bad fixtures for the OpenAPI per-method credential/privilege parser.
//
// The defect these pin (Codex 2026-08-29 #9): methodAuthOf matched only the
// literal `requireAuth(`, so a handler delegating to requireProGatedAuth
// (which accepts session AND acct_key by default) derived null, and
// securityFor's null fallback published AccountApiKey only. Generated clients
// were told a session cookie cannot call GET /channels while the runtime
// accepts it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { methodAuthOf, methodScopeOf, securityFor } from "./gen-openapi.mjs";

let bad = 0;
const check = (c, m) => (c ? console.log(`[gen-openapi-test] ok   ${m}`)
  : (bad++, console.error(`[gen-openapi-test] FAIL ${m}`)));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genapi-"));
const fixture = (name, src) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, src);
  return p;
};

// The exact shape the trend-warnings and channels handlers use.
const gatedDefault = fixture("gated-default.ts", `
export const GET = async (event) => {
  const principal = await requireProGatedAuth(event, {
    action: "list",
    resource_type: "channel",
    scopeLevel: "read",
    proGated: false,
  });
  return json({ ok: true });
};
`);
const a1 = methodAuthOf(gatedDefault);
check(Array.isArray(a1.get) && a1.get.includes("session") && a1.get.includes("acct_key"),
  "requireProGatedAuth with no allow option derives its default, session AND acct_key");
check(methodScopeOf(gatedDefault).get === "read",
  "scopeLevel inside requireProGatedAuth options is read as the method's privilege level");
check(JSON.stringify(securityFor("read", a1.get)) === JSON.stringify([{ AccountApiKey: [] }, { SessionCookie: [] }]),
  "the derived allow list publishes both credential kinds, not the AccountApiKey-only fallback");

// An explicit allow narrows it.
const gatedNarrow = fixture("gated-narrow.ts", `
export const POST = async (event) => {
  const principal = await requireProGatedAuth(event, {
    action: "create",
    resource_type: "channel",
    allow: ["session"],
    scopeLevel: "write",
  });
  return json({ ok: true });
};
`);
const a2 = methodAuthOf(gatedNarrow);
check(Array.isArray(a2.post) && a2.post.length === 1 && a2.post[0] === "session",
  "an explicit allow option inside requireProGatedAuth narrows the derived list");

// requireProGatedAuth callers omitting scopeLevel get the helper's own
// default ("write"), not null: null would either trip the ambiguity guard or
// publish the route marker again.
const gatedNoScope = fixture("gated-noscope.ts", `
export const DELETE = async (event) => {
  const principal = await requireProGatedAuth(event, { action: "delete", resource_type: "channel" });
  return json({ ok: true });
};
`);
check(methodScopeOf(gatedNoScope).delete === "write",
  "requireProGatedAuth without scopeLevel derives the helper's write default");

// The pre-existing shapes must not regress.
const plain = fixture("plain.ts", `
export const GET = async (event) => {
  const principal = await requireAuth(event, { allow: ["session"] });
  return json({ ok: true });
};
`);
check(JSON.stringify(methodAuthOf(plain).get) === JSON.stringify(["session"]),
  "plain requireAuth with an allow list still derives it");

const ungated = fixture("ungated.ts", `
export const GET = async () => json({ ok: true });
`);
check(methodAuthOf(ungated).get === null,
  "a handler with neither helper still derives null (gated some other way)");

fs.rmSync(tmp, { recursive: true, force: true });
if (bad) { console.error(`[gen-openapi-test] ${bad} failing`); process.exit(1); }
console.log("[gen-openapi-test] all fixtures behave as specified");
