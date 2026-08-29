#!/usr/bin/env node
// The OpenAPI document is hand-maintained and nothing checked it.
//
// An agent-readiness audit found it describes 9 paths while the product serves
// 51, has no operationIds, and called the API "Proprietary". Git history shows
// it had only ever been touched by rename sweeps, never by an endpoint change:
// drift-prone by construction, because a hand-written copy of a route table
// with no test is a copy that stops being true on the next commit.
//
// It now checks eight things, and the classification it uses is not a second
// list kept here: every route carries a `// scope:` marker that
// scope-markers.test.ts already enforces, and gen-openapi.mjs derives the
// contract from those. A list here could disagree with the routes; a marker on
// the route cannot.
//
//   1. Nothing documented is fictional.
//   2. Every operation has the handles a generator needs.
//   3. The licence does not claim the API is proprietary.
//   4. A self-hoster can generate a working client.
//   5. ZERO contract routes are undocumented. Not "no worse than last time".
//   5b. Every operation carries written prose, not a generated placeholder.
//   5c. The served file matches the generator, so it cannot be hand-edited back.
//   6. The published error reference matches the codes the server can emit.
//
import fs from "node:fs";
import path from "node:path";
import { build, contractRoutes } from "./gen-openapi.mjs";

const SPEC = "apps/dashboard/static/api/openapi.json";
const ROUTES = "apps/dashboard/src/routes/api/v1";

let failures = 0;
const fail = (m) => { failures++; console.error(`[openapi] FAIL ${m}`); };
const ok = (m) => console.log(`[openapi] ok   ${m}`);

const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));

// Every file route, as an OpenAPI-shaped path: [id] -> {id}
function routePaths(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const seg = e.name.startsWith("[") ? `{${e.name.replace(/^\[\.*/, "").replace(/\]$/, "")}}` : e.name;
      out.push(...routePaths(full, `${prefix}/${seg}`));
    } else if (e.name === "+server.ts") {
      out.push(prefix || "/");
    }
  }
  return out;
}

const actual = new Set(routePaths(ROUTES));
const documented = new Set(Object.keys(spec.paths ?? {}));

// 1. Nothing documented may be fictional.
{
  const ghosts = [...documented].filter((p) => !actual.has(p));
  if (ghosts.length) fail(`documents ${ghosts.length} path(s) that do not exist as routes: ${ghosts.join(", ")}`);
  else ok(`all ${documented.size} documented paths exist as real routes`);
}

// 2. Every operation needs the handles a generator relies on.
{
  const VERBS = ["get", "post", "put", "patch", "delete"];
  const bad = [];
  const ids = new Map();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    for (const verb of VERBS) {
      const op = item[verb];
      if (!op) continue;
      if (!op.operationId) bad.push(`${verb.toUpperCase()} ${p}: no operationId`);
      else if (ids.has(op.operationId)) bad.push(`duplicate operationId ${op.operationId}`);
      else ids.set(op.operationId, `${verb} ${p}`);
      if (!op.tags?.length) bad.push(`${verb.toUpperCase()} ${p}: no tags`);
    }
  }
  if (bad.length) fail(`operations missing generator handles: ${bad.slice(0, 6).join("; ")}`);
  else ok(`all ${ids.size} operations carry a unique operationId and a tag`);
}

// 3. The licence must not claim the API is proprietary. It is AGPL-3.0-only,
//    and this is the surface a machine reads to decide what it may do.
{
  const name = spec.info?.license?.name ?? "";
  if (/proprietar/i.test(name)) fail(`info.license.name still claims the API is proprietary: "${name}"`);
  else if (!name) fail("info.license.name is empty");
  else ok(`licence states ${name}`);
}

// 4. A self-hoster must be able to generate a working client.
{
  const urls = (spec.servers ?? []).map((s) => s.url);
  if (!urls.some((u) => u.includes("{"))) fail("servers has no templated URL, so a self-hosted client cannot be generated");
  else ok(`servers offers ${urls.length} target(s) including a self-host variable`);
}

// 5. ZERO undocumented public routes. Not "no wider than last time": the gap
//    is closed and must stay closed. Every route is classified by the
//    `// scope:` marker that scope-markers.test.ts already enforces, so the
//    classification lives on the route rather than in a second list here that
//    could disagree with it.
{
  const contract = contractRoutes().map((r) => r.apiPath);
  const missing = contract.filter((p) => !documented.has(p));
  if (missing.length) {
    fail(
      `${missing.length} route(s) belong in the published contract and are not documented: ` +
        `${missing.join(", ")}. Run node scripts/gen-openapi.mjs, and add prose in ` +
        `scripts/openapi-descriptions.json.`,
    );
  } else {
    ok(`all ${contract.length} contract routes are documented; no gap`);
  }
}

// 5b. Every operation carries real prose. A generated skeleton with a summary
//     of "GET /servers" is a document that exists rather than one that helps.
{
  const VERBS = ["get", "post", "put", "patch", "delete"];
  const bare = [];
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    for (const v of VERBS) {
      const op = item[v];
      if (!op) continue;
      if (!op.description) bare.push(`${v.toUpperCase()} ${p}: no description`);
      else if (!op.summary || op.summary.startsWith(`${v.toUpperCase()} `)) {
        bare.push(`${v.toUpperCase()} ${p}: placeholder summary`);
      }
    }
  }
  if (bare.length) fail(`operations without written prose: ${bare.slice(0, 6).join("; ")}`);
  else ok("every operation carries a written summary and description");
}

// 5c. The served document must match what the generator produces, or the
//     generator is decorative and the served file is hand-edited again.
{
  const generated = JSON.stringify(build(), null, 2) + "\n";
  const served = fs.readFileSync(SPEC, "utf8");
  if (generated !== served) {
    fail(`${SPEC} does not match scripts/gen-openapi.mjs output. Run: node scripts/gen-openapi.mjs`);
  } else {
    ok("the served document matches the generator");
  }
}

// 6. The published error reference must list exactly the codes the server can
//    emit. Every error response points a client at
//    /docs/api/errors#<code>, so a code the page does not document is a link to
//    an anchor that is not there, and a documented code the server cannot
//    produce is a promise about behaviour that does not exist.
{
  const src = fs.readFileSync("apps/dashboard/src/lib/server/api/errors.ts", "utf8");
  const emitted = new Set([...src.matchAll(/^\s*\d{3}:\s*"([a-z_]+)"/gm)].map((m) => m[1]));
  // Codes a callsite supplies explicitly rather than by status, plus the
  // fallbacks codeForStatus can return.
  for (const m of src.matchAll(/\?\?\s*\(status >= 500 \? "([a-z_]+)" : "([a-z_]+)"\)/g)) {
    emitted.add(m[1]);
    emitted.add(m[2]);
  }
  for (const extra of ["unknown_endpoint", "pro_required"]) emitted.add(extra);

  const doc = JSON.parse(fs.readFileSync("apps/site/src/lib/data/api-error-codes.json", "utf8"));
  const documented = new Set(doc.codes.map((c) => c.code));

  const undocumented = [...emitted].filter((c) => !documented.has(c));
  const fictional = [...documented].filter((c) => !emitted.has(c));

  if (undocumented.length) {
    fail(`the server can emit code(s) the error reference does not document: ${undocumented.join(", ")}`);
  } else if (fictional.length) {
    fail(`the error reference documents code(s) the server cannot emit: ${fictional.join(", ")}`);
  } else {
    ok(`the error reference documents exactly the ${documented.size} codes the server can emit`);
  }
}

if (failures) {
  console.error(`[openapi] ${failures} failing check(s)`);
  process.exit(1);
}
console.log("[openapi] all OpenAPI drift checks pass");
