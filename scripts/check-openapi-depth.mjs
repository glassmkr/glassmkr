#!/usr/bin/env node
// Depth checks for the OpenAPI document.
//
// check-openapi-drift.mjs proves COVERAGE: every contract route is documented
// and nothing documented is fictional. That is necessary and not sufficient. A
// document can list every route and still be useless to a client if the request
// bodies are absent, the success responses have no schema, the error shape is
// undeclared, or the security requirements do not match what the server
// actually enforces.
//
// So this proves DEPTH, in four static checks and three runtime ones:
//
//   1. Every POST/PUT/PATCH declares a request body with a schema.
//   2. Every success response declares a schema.
//   3. Every operation references the shared ApiError for its failure codes.
//   4. Every operation's declared security matches the credentials its
//      handler actually accepts, read from its requireAuth call.
//   5. RUNTIME: an operation that declares security actually rejects an
//      unauthenticated call. A declaration the server does not enforce is worse
//      than no declaration.
//   6. RUNTIME: a client generated from the document, aimed at the origin the
//      operator supplied, calls every PUBLIC operation and each response
//      validates against its declared schema in full. Secured operations are
//      NOT covered here: validating their responses needs a credential this
//      check does not hold, so their success schemas are unverified at runtime
//      and check 5 proves only that they reject an unauthenticated call.
//   7. RUNTIME: the conventional /openapi.json path reaches the canonical one.
//
// The runtime checks need an origin: `node scripts/check-openapi-depth.mjs
// https://app.glassmkr.com`. Without one they are skipped and reported as
// skipped, never as passed.
import fs from "node:fs";
import { contractRoutes, methodAuthOf } from "./gen-openapi.mjs";

const SPEC = "apps/dashboard/static/api/openapi.json";
const argv = process.argv.slice(2);
const ORIGIN = argv.find((a) => !a.startsWith("--")) ?? null;
// The enforcement probe fires an UNAUTHENTICATED request at every secured
// operation, including POST, PUT, PATCH and DELETE. Against a deployment you
// own that is the whole point. Against production it is a deliberate act, so
// `--probes public` limits the probe to read-only operations and reports the
// rest as skipped rather than as passed.
const PROBES = argv.includes("--probes")
  ? argv[argv.indexOf("--probes") + 1]
  : "all";
if (!["all", "public"].includes(PROBES)) {
  console.error(`[depth] --probes must be "all" or "public", got "${PROBES}"`);
  process.exit(2);
}
const VERBS = ["get", "post", "put", "patch", "delete"];

let failures = 0;
let skipped = 0;
const fail = (c, m) => { failures++; console.error(`[depth] FAIL ${c}: ${m}`); };
const ok = (c, m) => console.log(`[depth] ok   ${c}: ${m}`);
// A skipped check is a check that did not pass. It is counted so the summary
// cannot describe a partial run as a complete one.
const skip = (c, m) => { skipped++; console.log(`[depth] skip ${c}: ${m}`); };
// A stated coverage limit of the chosen SAFE mode, not a check that failed to
// run. --probes public never probes mutations and never validates secured
// success schemas (doing either needs a credential or an unsafe probe), so on
// a production run these lines are permanent and correct. Counting them as
// skips made every prod verification read INCOMPLETE forever, which trains
// people to ignore exit 2, the exact failure the exit-2 convention exists to
// prevent. Notes print (no silent caps) but do not gate the exit code.
const note = (c, m) => { console.log(`[depth] note ${c}: ${m}`); };

const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));

function operations() {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const verb of VERBS) if (item[verb]) out.push({ path, verb, op: item[verb] });
  }
  return out;
}
const ops = operations();

// 1. Request bodies.
{
  const bad = ops
    .filter((o) => ["post", "put", "patch"].includes(o.verb))
    .filter((o) => !o.op.requestBody?.content?.["application/json"]?.schema)
    .map((o) => `${o.verb.toUpperCase()} ${o.path}`);
  if (bad.length) fail("request-bodies", `${bad.length} mutation(s) with no request schema: ${bad.slice(0, 6).join(", ")}`);
  else ok("request-bodies", `all ${ops.filter((o) => ["post", "put", "patch"].includes(o.verb)).length} mutations declare a request schema`);
}

// 2. Success responses.
{
  const bad = [];
  for (const { path, verb, op } of ops) {
    const success = Object.keys(op.responses ?? {}).filter((c) => c.startsWith("2"));
    if (!success.length) bad.push(`${verb.toUpperCase()} ${path}: no 2xx`);
    for (const c of success) {
      if (!op.responses[c]?.content?.["application/json"]?.schema) {
        bad.push(`${verb.toUpperCase()} ${path} ${c}: no schema`);
      }
    }
  }
  if (bad.length) fail("success-schemas", `${bad.length} problem(s): ${bad.slice(0, 6).join("; ")}`);
  else ok("success-schemas", `all ${ops.length} operations declare a schema for every success response`);
}

// 3. The shared error schema. A client should be able to generate one error type
//    and use it everywhere, which only works if every operation points at it.
{
  const wanted = ["400", "401", "403", "404", "429", "500"];
  const bad = [];
  for (const { path, verb, op } of ops) {
    const missing = wanted.filter((c) => {
      const r = op.responses?.[c];
      return !r || (r.$ref !== "#/components/responses/Error" && !r.content?.["application/json"]?.schema?.$ref);
    });
    if (missing.length) bad.push(`${verb.toUpperCase()} ${path}: ${missing.join(",")}`);
  }
  const schema = spec.components?.schemas?.ApiError;
  if (!schema) fail("error-schema", "components.schemas.ApiError is not defined");
  else if (!["error", "message", "retryable"].every((k) => schema.properties?.[k])) {
    fail("error-schema", "ApiError is missing one of error, message, retryable");
  } else if (bad.length) {
    fail("error-schema", `${bad.length} operation(s) do not reference the shared error: ${bad.slice(0, 4).join("; ")}`);
  } else ok("error-schema", `ApiError is defined and referenced by all ${ops.length} operations`);
}

// 4. Declared security must match what the HANDLER accepts.
//
//    This deliberately does not ask the generator what it would have produced,
//    which would only prove the document agrees with itself. It reads each
//    handler's requireAuth call and asserts the invariants directly. The
//    previous version compared against the route-level `// scope:` marker, so
//    when POST /account/keys was marked `read` while its handler accepted a
//    session only, the document advertised a bearer key, the check compared the
//    wrong marker against itself, and it passed.
{
  const byPath = new Map(contractRoutes().map((r) => [r.apiPath, r]));
  const authCache = new Map();
  const bad = [];
  for (const { path, verb, op } of ops) {
    const route = byPath.get(path);
    if (!route) { bad.push(`${verb.toUpperCase()} ${path}: documented but not a contract route`); continue; }
    if (!authCache.has(route.file)) authCache.set(route.file, methodAuthOf(route.file));
    const allow = authCache.get(route.file)[verb];
    const declared = (op.security ?? []).flatMap((x) => Object.keys(x));
    const label = `${verb.toUpperCase()} ${path}`;

    if (route.scope === "public") {
      if (declared.length) bad.push(`${label}: public route declares ${declared.join(",")}`);
      continue;
    }
    if (route.scope === "cru-key-only") {
      if (!declared.includes("CollectorKey")) bad.push(`${label}: collector route declares ${declared.join(",") || "nothing"}`);
      continue;
    }
    if (!declared.length) {
      bad.push(`${label}: authenticated route declares no security, telling a client it needs no credential`);
      continue;
    }
    if (!allow) continue; // gated some other way; nothing to cross-check
    if (!allow.includes("acct_key") && declared.includes("AccountApiKey")) {
      bad.push(`${label}: handler accepts ${JSON.stringify(allow)} but the document advertises AccountApiKey, so a client is told to send a key that can never work`);
    }
    if (allow.includes("acct_key") && !declared.includes("AccountApiKey")) {
      bad.push(`${label}: handler accepts an account key but the document does not offer AccountApiKey`);
    }
    if (allow.includes("session") && !declared.includes("SessionCookie")) {
      bad.push(`${label}: handler accepts a session but the document does not offer SessionCookie`);
    }
  }
  // Published privilege must match what the handler enforces. Asserted from
  // the handler's own requireScopeLevel / scopeLevel call rather than from the
  // generator's output, so this cannot pass by agreeing with itself. The old
  // document published the route-level marker for every method in a file, so
  // seven mutations advertised `read` while requiring `write` or `admin`.
  // A SEPARATE parser, deliberately not the generator's. Not fully
  // independent: both still assume scope enforcement is textually visible
  // inside an `export const VERB` handler body, so a handler that delegates
  // its gating to a helper defined elsewhere would be misread the same way by
  // both. Full independence means an AST walk or runtime probes with a
  // wrong-scope credential; the runtime check below only proves
  // unauthenticated calls are refused. What the separation DOES buy: a regex
  // bug in one implementation no longer agrees with itself.
  //
  // The first version of this check imported methodScopeOf from
  // gen-openapi.mjs, so the document and the check shared one parser: any
  // misreading of a handler would be made twice and agree with itself. That is
  // the same defect as the original marker check, one level up. This reads the
  // handler a different way (split on the closing brace of the exported const,
  // scan for either enforcement shape) so two implementations must agree
  // before the check passes.
  const scopeCache = new Map();
  const independentScopes = (file) => {
    const src = fs.readFileSync(file, "utf8");
    const found = {};
    // Segment by exported handler using a different anchor from the generator:
    // the generator finds `export const GET`, this splits on it.
    const parts = src.split(/export\s+const\s+(?=(?:GET|POST|PUT|PATCH|DELETE)\b)/);
    for (const part of parts.slice(1)) {
      const verb = (part.match(/^(GET|POST|PUT|PATCH|DELETE)\b/) ?? [])[1];
      if (!verb) continue;
      const levels = [];
      for (const m of part.matchAll(/requireScopeLevel\s*\([^)]*?["'](read|write|admin)["']/g)) levels.push(m[1]);
      for (const m of part.matchAll(/scopeLevel\s*:\s*["'](read|write|admin)["']/g)) levels.push(m[1]);
      const rank = { read: 1, write: 2, admin: 3 };
      found[verb.toLowerCase()] = levels.length
        ? levels.reduce((a, b) => (rank[b] > rank[a] ? b : a))
        : null;
    }
    return found;
  };

  for (const { path, verb, op } of ops) {
    const route = byPath.get(path);
    if (!route || route.scope === "public" || route.scope === "cru-key-only") continue;
    if (!scopeCache.has(route.file)) scopeCache.set(route.file, independentScopes(route.file));
    const enforced = scopeCache.get(route.file)[verb];
    const published = op["x-glassmkr-scope"];
    const label = `${verb.toUpperCase()} ${path}`;
    if (enforced && published !== enforced) {
      bad.push(`${label}: publishes scope "${published}" but the handler enforces "${enforced}"`);
    }
    if (!enforced && published && published !== route.scope) {
      bad.push(`${label}: publishes scope "${published}" that no handler enforces`);
    }
  }

  // Every scheme an operation names must actually be defined.
  const defined = new Set(Object.keys(spec.components?.securitySchemes ?? {}));
  for (const { path, verb, op } of ops) {
    for (const name of (op.security ?? []).flatMap((x) => Object.keys(x))) {
      if (!defined.has(name)) bad.push(`${verb.toUpperCase()} ${path}: names undefined security scheme ${name}`);
    }
  }
  if (bad.length) fail("security-declarations", `${bad.length} problem(s): ${bad.slice(0, 8).join("; ")}`);
  else ok("security-declarations", `every operation's declared credential kind AND privilege level match its handler (${ops.length} operations)`);
}

// 5. RUNTIME: the server actually enforces what the document declares.
if (!ORIGIN) {
  skip("security-runtime", "no origin given; pass one to check enforcement");
} else {
  const allSecured = ops.filter((o) => (o.op.security ?? []).length > 0);
  const secured = PROBES === "public" ? allSecured.filter((o) => o.verb === "get") : allSecured;
  if (PROBES === "public") {
    note("security-runtime-mutating", `--probes public: ${allSecured.length - secured.length} mutating operation(s) were NOT probed for enforcement`);
  }
  const bad = [];
  for (const { path, verb } of secured) {
    // Substitute a syntactically valid but non-existent id. An unauthenticated
    // call must be rejected before the id is ever looked up, so the value does
    // not matter; what matters is that the answer is 401 and not 404 or 200.
    const url = ORIGIN + "/api/v1" + path.replace(/\{[^}]+\}/g, "openapi-depth-probe");
    let res;
    try {
      res = await fetch(url, { method: verb.toUpperCase(), headers: { "content-type": "application/json" },
        body: ["post", "put", "patch"].includes(verb) ? "{}" : undefined });
    } catch (e) {
      bad.push(`${verb.toUpperCase()} ${path}: ${e.message}`);
      continue;
    }
    if (res.status !== 401) bad.push(`${verb.toUpperCase()} ${path}: expected 401 unauthenticated, got ${res.status}`);
  }
  if (bad.length) fail("security-runtime", `${bad.length} of ${secured.length} secured operation(s) did not reject an unauthenticated call: ${bad.slice(0, 6).join("; ")}`);
  else ok("security-runtime", `all ${secured.length} secured operations reject an unauthenticated call with 401`);
}

// 6. RUNTIME: a generated client works and the responses match their schemas.
//
//    Deliberately a real generated client rather than a hand-written fetch: the
//    point is that the DOCUMENT is usable, not that the endpoint is up.
//
//    Two earlier faults are fixed here. The client built its URL from the
//    document's hosted `servers` entry and only fell back to the supplied
//    origin, so pointing this at a self-hosted deployment or a staging box
//    silently tested production instead, which is the opposite of what the
//    operator asked for. And it probed a hardcoded pair of operations and
//    checked only top-level primitive types, so a nested object could be any
//    shape at all and still pass.
if (!ORIGIN) {
  skip("generated-client", "no origin given; pass one to exercise a generated client");
} else {
  // The origin under test wins. Only the PATH is taken from the document,
  // because that is the part of the server URL the contract actually fixes.
  let basePath = "/api/v1";
  const declared = (spec.servers ?? []).map((s2) => s2.url).find((u) => !u.includes("{"));
  if (declared) {
    try { basePath = new URL(declared).pathname.replace(/\/$/, "") || ""; }
    catch { basePath = declared.startsWith("/") ? declared.replace(/\/$/, "") : basePath; }
  }
  const baseUrl = ORIGIN.replace(/\/$/, "") + basePath;

  const client = {};
  for (const { path, verb, op } of ops) {
    client[op.operationId] = async (params = {}, init = {}) =>
      fetch(baseUrl + path.replace(/\{([^}]+)\}/g, (_, k) => encodeURIComponent(params[k])),
        { method: verb.toUpperCase(), ...init });
  }

  // Resolve a local $ref against the document.
  const deref = (node, seen = 0) => {
    if (!node || typeof node !== "object" || !node.$ref || seen > 20) return node;
    const parts = node.$ref.replace(/^#\//, "").split("/");
    let cur = spec;
    for (const seg of parts) cur = cur?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    return deref(cur, seen + 1);
  };

  // Recursive validation: required keys, declared types, enums, and the shape
  // of nested objects and array items, all the way down.
  function validate(schema, value, where, out, depth = 0) {
    schema = deref(schema);
    if (!schema || depth > 12) return;
    if (Array.isArray(schema.allOf)) for (const sub of schema.allOf) validate(sub, value, where, out, depth + 1);
    for (const kw of ["oneOf", "anyOf"]) {
      if (Array.isArray(schema[kw])) {
        const branch = [];
        const anyPass = schema[kw].some((sub) => { const t = []; validate(sub, value, where, t, depth + 1); branch.push(t); return t.length === 0; });
        if (!anyPass) out.push(`${where}: matches none of the ${schema[kw].length} ${kw} branches`);
        return;
      }
    }
    const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (types) {
      const permitted = schema.nullable ? [...types, "null"] : types;
      const satisfied = permitted.includes(actual) || (permitted.includes("integer") && actual === "number" && Number.isInteger(value));
      if (!satisfied) { out.push(`${where}: is ${actual}, document says ${permitted.join("|")}`); return; }
    }
    if (value === null || value === undefined) return;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      out.push(`${where}: value ${JSON.stringify(value)} is outside the declared enum`);
    }
    if (actual === "object") {
      for (const req of schema.required ?? []) {
        if (!(req in value)) out.push(`${where}.${req}: required by the document, absent from the response`);
      }
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        if (k in value) validate(sub, value[k], `${where}.${k}`, out, depth + 1);
      }
      if (schema.additionalProperties === false) {
        const extra = Object.keys(value).filter((k) => !(schema.properties ?? {})[k]);
        if (extra.length) out.push(`${where}: undocumented field(s) ${extra.slice(0, 5).join(",")} on a closed object`);
      }
    }
    if (actual === "array" && schema.items) {
      value.forEach((el, i) => validate(schema.items, el, `${where}[${i}]`, out, depth + 1));
    }
  }

  // Every operation the document says needs no credential, not a hardcoded
  // pair. These are exactly the operations a stranger can verify.
  const probes = ops.filter((o) => (o.op.security ?? []).length === 0 && o.verb === "get");
  if (!probes.length) {
    fail("generated-client", "no public GET operation to exercise; the generated client could not be tested at all");
  } else {
    const bad = [];
    let validated = 0;
    for (const probe of probes) {
      const id = probe.op.operationId;
      let res, body;
      try {
        res = await client[id]();
        body = await res.json();
      } catch (e) { bad.push(`${id}: ${e.message}`); continue; }
      if (!res.ok) { bad.push(`${id}: HTTP ${res.status}`); continue; }
      const success = Object.keys(probe.op.responses ?? {}).find((c) => c.startsWith("2"));
      const schema = probe.op.responses?.[success]?.content?.["application/json"]?.schema;
      if (!schema) { bad.push(`${id}: no schema declared for ${success}`); continue; }
      const problems = [];
      validate(schema, body, id, problems);
      if (problems.length) bad.push(...problems.slice(0, 4));
      else validated++;
    }
    if (bad.length) fail("generated-client", `${bad.length} problem(s) against ${baseUrl}: ${bad.slice(0, 8).join("; ")}`);
    else {
      ok("generated-client", `a client generated from the document called ${validated} PUBLIC operation(s) at ${baseUrl} and every response validated in full, including nested objects and arrays`);
      // Say what was NOT covered, in the same breath. Success-response schemas
      // are validated for public operations only, because exercising a secured
      // one needs a credential this check deliberately does not hold. Every
      // secured operation is probed for ENFORCEMENT (a 401), which is a
      // different property: it proves the door is locked, not that the room
      // behind it matches the floor plan.
      const secured = ops.filter((o) => (o.op.security ?? []).length > 0).length;
      note("generated-client-secured", `${secured} secured operation(s) had their success schemas UNVALIDATED at runtime; they were probed for 401 enforcement only, which does not check response shape`);
    }
  }
}

// 7. The conventional path must reach the canonical one. /openapi.json is where
//    a client looks first, and it used to 404, which tells an agent there is no
//    machine contract at all.
if (!ORIGIN) {
  skip("openapi-conventional-path", "no origin given");
} else {
  try {
    const res = await fetch(ORIGIN + "/openapi.json", { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    if (res.status === 200) ok("openapi-conventional-path", "/openapi.json serves the document directly");
    else if ([301, 302, 307, 308].includes(res.status) && location.includes("openapi.json")) {
      ok("openapi-conventional-path", `/openapi.json redirects (${res.status}) to ${location}`);
    } else {
      fail("openapi-conventional-path", `/openapi.json returned ${res.status}${location ? ` -> ${location}` : ""}; a client looking at the conventional path finds nothing`);
    }
  } catch (e) {
    fail("openapi-conventional-path", e.message);
  }
}

if (failures) {
  console.error(`[depth] ${failures} failing check(s)`);
  process.exit(1);
}
if (skipped) {
  // Skips are INCOMPLETE, not success (exit 2, same convention as
  // check-machine-surface and check-exhibits). A no-origin run used to exit 0,
  // so CI read "authentication enforcement unverified" as green (Codex
  // 2026-08-29 #10). --allow-skips is the explicit human waiver for a context
  // that genuinely has no origin to probe (PR CI): the waiver is then visible
  // in the invocation instead of implied by an exit code.
  console.log(`[depth] ${skipped} check(s) did not run. The static checks pass; the runtime properties are UNVERIFIED.`);
  if (argv.includes("--allow-skips")) {
    console.log("[depth] --allow-skips given: treating the unverified runtime properties as waived for this run");
    process.exit(0);
  }
  console.error("[depth] INCOMPLETE: pass an origin to run the runtime checks, or --allow-skips to waive them explicitly");
  process.exit(2);
}
console.log("[depth] all OpenAPI depth checks pass, static and runtime");
