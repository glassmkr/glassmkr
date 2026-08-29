#!/usr/bin/env node
// Generate the OpenAPI document from the routes themselves.
//
// The served spec used to be a hand-maintained JSON file. It described 9 of 51
// routes, had no operationIds, and called the API proprietary; git history shows
// it had only ever been touched by rename sweeps, never by an endpoint change. A
// hand-written copy of a route table with no test is a copy that stops being
// true on the next commit, which is the same defect this project keeps finding
// on its public surfaces.
//
// So the structural half is now derived and cannot drift:
//
//   paths          the filesystem under routes/api/v1
//   methods        the `export const GET|POST|...` in each +server.ts
//   path params    the [id] segments
//   security       the `// scope:` marker that scope-markers.test.ts already
//                  enforces on every route
//   error responses  every operation, from the shared envelope
//
// The half a machine cannot infer lives in openapi-descriptions.json next to
// this script: summaries, descriptions, request and response schemas. That file
// is hand-written on purpose, because inventing a response schema is worse than
// admitting there is not one yet: a client generated from a wrong contract fails
// in ways a client with no contract does not.
//
// check-openapi-drift.mjs verifies the served file matches what this produces.
import fs from "node:fs";
import path from "node:path";

const ROUTES = "apps/dashboard/src/routes/api/v1";
const OUT = "apps/dashboard/static/api/openapi.json";
const DESCRIPTIONS = "scripts/openapi-descriptions.json";

const VERBS = ["get", "post", "put", "patch", "delete"];

// Which scope markers belong in the public contract.
//
//   read / write / admin  the account-key API surface. Documented.
//   cru-key-only          the collector's ingest endpoint. Documented: an
//                         operator writing provisioning automation needs it.
//   public                mixed. Some are genuinely part of the contract
//                         (health, version, host-profiles); the rest are
//                         browser flows and inbound webhooks, listed below.
//   session-only          browser session flows. An API client cannot use them.
//   internal-secret       operator infrastructure.
const CONTRACT_SCOPES = new Set(["read", "write", "admin", "cru-key-only"]);
const PUBLIC_IN_CONTRACT = new Set(["/health", "/version", "/host-profiles"]);

// The `admin` marker answers "which credential does this need", not "is this
// part of the published contract", and for a handful of routes those differ.
// Each entry is a decision with its reason, not a backlog item.
const NOT_IN_CONTRACT = new Map([
  ["/billing/checkout", "retired; answers 410 no_paid_tier to every call"],
  ["/billing/portal", "browser redirect into the payment provider"],
  ["/billing/downgrade", "browser session flow with a confirmation step in the UI"],
  ["/billing/resume", "browser session flow"],
  ["/auth/admin/suspend/{customerId}", "operator-only, gated on a specific admin email"],
]);

// The `// scope:` marker is ROUTE level, and inside the contract three routes
// have methods that do not share one credential:
//
//   GET  /account/keys            session or account key
//   POST /account/keys            session ONLY, because an account key minting
//                                 another account key is not permitted in v1
//   DELETE /account/keys/{id}     session only, marked `admin`
//   POST /account/keys/{id}/rotate  session only, marked `admin`
//
// A route-level marker cannot express that. Advertising `AccountApiKey` on
// those methods told every generated client to attempt a call that returns 401
// no matter what key it holds.
//
// So the declared security is DERIVED PER METHOD from each handler's own
// requireAuth call, which is the thing that actually runs. The marker still
// decides whether a route belongs in the published contract; it no longer
// decides what a method accepts. A marker cannot drift away from the handler
// if it is not consulted for this.
const DEFAULT_ALLOW = ["session", "acct_key"];

/**
 * Per-verb `allow` list, read from the requireAuth call inside each exported
 * handler. Returns null for a verb that has no requireAuth call, meaning it is
 * gated some other way (the collector ingest route) or not gated at all.
 */
export function methodAuthOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const starts = [];
  for (const v of VERBS) {
    const m = new RegExp(`export const ${v.toUpperCase()}\\b`).exec(src);
    if (m) starts.push({ verb: v, at: m.index });
  }
  starts.sort((a, b) => a.at - b.at);

  const parseAllow = (optsBody) => {
    const allow = /allow:\s*\[([^\]]*)\]/.exec(optsBody);
    return allow
      ? allow[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : [...DEFAULT_ALLOW];
  };

  const out = {};
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    if (/requireAuth\s*\(/.test(body)) {
      const opts = /requireAuth\s*\(\s*event\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(body);
      out[starts[i].verb] = opts ? parseAllow(opts[1]) : [...DEFAULT_ALLOW];
      continue;
    }
    // requireProGatedAuth wraps requireAuth with the same allow semantics and
    // the same default (["session", "acct_key"], gate.ts). It does NOT contain
    // the literal "requireAuth(", so before 2026-08-29 every handler using it
    // derived null here and securityFor's null fallback published
    // AccountApiKey only: generated clients were told a session cannot call
    // an operation the runtime happily serves it (Codex 2026-08-29 #9).
    if (/requireProGatedAuth\s*\(/.test(body)) {
      const opts = /requireProGatedAuth\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(body);
      out[starts[i].verb] = opts ? parseAllow(opts[1]) : [...DEFAULT_ALLOW];
      continue;
    }
    out[starts[i].verb] = null;
  }
  return out;
}

/**
 * Per-verb PRIVILEGE LEVEL, read from each handler's own scope enforcement.
 *
 * Credential KIND (which token type is accepted) and privilege LEVEL (how much
 * authority it needs) are different facts, and until now only the first was
 * derived. The route-level `// scope:` marker carries the minimum across a
 * file's methods, and that single value was published as x-glassmkr-scope for
 * every method in the file. So POST /servers, PATCH and DELETE /servers/{id},
 * both /servers/{id}/mutes methods and POST /channels all advertised `read`
 * while their handlers require `write`. A client trusting the document would
 * mint a read key, and every mutation would 403.
 *
 * Two enforcement shapes exist in the codebase and both are read here:
 *   requireScopeLevel(principal, "write")
 *   requireAuth(event, { ..., scopeLevel: "write" })
 *
 * When a method enforces more than one (a branch that escalates), the HIGHEST
 * wins, because that is what a caller must hold to get through every path.
 */
const SCOPE_RANK = { read: 1, write: 2, admin: 3 };

export function methodScopeOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const starts = [];
  for (const v of VERBS) {
    const m = new RegExp(`export const ${v.toUpperCase()}\\b`).exec(src);
    if (m) starts.push({ verb: v, at: m.index });
  }
  starts.sort((a, b) => a.at - b.at);

  const out = {};
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    const found = [
      ...body.matchAll(/requireScopeLevel\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*["'](read|write|admin)["']/g),
      ...body.matchAll(/scopeLevel\s*:\s*["'](read|write|admin)["']/g),
    ].map((m) => m[1]);
    // requireProGatedAuth defaults scopeLevel to "write" (gate.ts); a caller
    // omitting the option is enforcing write, not enforcing nothing.
    if (!found.length && /requireProGatedAuth\s*\(/.test(body)) found.push("write");
    out[starts[i].verb] = found.length
      ? found.reduce((a, b) => (SCOPE_RANK[b] > SCOPE_RANK[a] ? b : a))
      : null;
  }
  return out;
}

/**
 * Declared security for one method. A list of alternatives: OpenAPI reads
 * `[{A:[]},{B:[]}]` as A OR B, which is what a route accepting either a
 * session cookie or a bearer key actually does.
 */
export function securityFor(scope, allow) {
  if (scope === "cru-key-only") return [{ CollectorKey: [] }];
  if (scope === "public") return [];
  // No requireAuth in the handler: fall back to the marker rather than
  // silently declaring the operation public.
  if (!allow) return [{ AccountApiKey: [] }];
  return allow.includes("acct_key")
    ? [{ AccountApiKey: [] }, { SessionCookie: [] }]
    : [{ SessionCookie: [] }];
}

export function scopeOf(file) {
  const head = fs.readFileSync(file, "utf8").split("\n").slice(0, 20).join("\n");
  const m = head.match(/\/\/\s*scope:\s*([a-z-]+)/);
  return m ? m[1] : null;
}

export function methodsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  return VERBS.filter((v) => new RegExp(`export const ${v.toUpperCase()}\\b`).test(src));
}

export function routeList(dir = ROUTES, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      const seg = e.name.startsWith("[")
        ? `{${e.name.replace(/^\[\.*/, "").replace(/\]$/, "")}}`
        : e.name;
      out.push(...routeList(full, `${prefix}/${seg}`));
    } else if (e.name === "+server.ts") {
      out.push({ apiPath: prefix || "/", file: full, scope: scopeOf(full), methods: methodsOf(full) });
    }
  }
  return out;
}

/** Routes that belong in the published contract. */
export function contractRoutes() {
  return routeList().filter(
    (r) =>
      !NOT_IN_CONTRACT.has(r.apiPath) &&
      (CONTRACT_SCOPES.has(r.scope ?? "") ||
        (r.scope === "public" && PUBLIC_IN_CONTRACT.has(r.apiPath))),
  );
}

function operationId(apiPath, verb) {
  const words = apiPath
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith("{")
        ? "By" + seg.slice(1, -1).replace(/^./, (c) => c.toUpperCase())
        : seg.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase()),
    )
    .join("");
  const prefix = { get: "get", post: "create", put: "replace", patch: "update", delete: "delete" }[verb];
  return prefix + (words || "Root");
}

function tagFor(apiPath) {
  const head = apiPath.replace(/^\//, "").split("/")[0] || "root";
  return (
    { servers: "Servers", "trashed-servers": "Servers", account: "Account", ingest: "Ingest",
      channels: "Channels", alerts: "Alerts", "trend-warnings": "Trend warnings",
      "host-profiles": "Reference", version: "Reference", health: "Reference" }[head] ??
    head.replace(/^./, (c) => c.toUpperCase())
  );
}

const ERROR_RESPONSES = ["400", "401", "403", "404", "429", "500"];

export function build() {
  const desc = JSON.parse(fs.readFileSync(DESCRIPTIONS, "utf8"));
  const base = desc._document;
  const spec = { ...base, paths: {} };

  for (const r of contractRoutes().sort((a, b) => a.apiPath.localeCompare(b.apiPath))) {
    const item = {};
    const params = [...r.apiPath.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));

    const auth = methodAuthOf(r.file);
    const scopes = methodScopeOf(r.file);

    for (const verb of r.methods) {
      const key = `${verb.toUpperCase()} ${r.apiPath}`;
      const hand = desc.operations?.[key] ?? {};
      const op = {
        operationId: hand.operationId ?? operationId(r.apiPath, verb),
        tags: [tagFor(r.apiPath)],
        summary: hand.summary ?? `${verb.toUpperCase()} ${r.apiPath}`,
        ...(hand.description ? { description: hand.description } : {}),
        ...(params.length ? { parameters: [...params, ...(hand.parameters ?? [])] } : hand.parameters ? { parameters: hand.parameters } : {}),
        ...(hand.requestBody ? { requestBody: hand.requestBody } : {}),
        security: securityFor(r.scope, auth[verb]),
        responses: {
          ...(hand.responses ?? { 200: { description: "Success" } }),
          ...Object.fromEntries(ERROR_RESPONSES.map((c) => [c, { $ref: "#/components/responses/Error" }])),
        },
        // The privilege level THIS METHOD enforces, read from its own handler.
        // Falls back to the route marker only for a method that enforces no
        // level of its own (a public or collector-key route).
        ...(scopes[verb]
          ? { "x-glassmkr-scope": scopes[verb] }
          : auth[verb] && !auth[verb].includes("acct_key")
            // Session-only: no API key can reach it, so there is no scope to
            // publish. Saying so explicitly beats implying a key would work.
            ? { "x-glassmkr-scope": null, "x-glassmkr-scope-note": "session-only; not reachable with an account key" }
            : { "x-glassmkr-scope": r.scope }),
        // The route-level marker, kept as a separate field so the two facts are
        // never confused again. scope-markers.test.ts enforces this one.
        "x-glassmkr-route-scope": r.scope,
        // The credentials this METHOD accepts, read from its requireAuth call.
        // "session" here means a browser session that an API client cannot
        // obtain, so a method listing only that is not callable with a key.
        ...(auth[verb] ? { "x-glassmkr-auth": auth[verb] } : {}),
      };
      item[verb] = op;
    }
    spec.paths[r.apiPath] = item;
  }

  // A secured operation with no derivable privilege level would publish the
  // route marker again, which is the defect this replaced. Fail generation
  // instead of quietly reintroducing it.
  const ambiguous = [];
  for (const r of contractRoutes()) {
    if (r.scope === "public" || r.scope === "cru-key-only") continue;
    const scopes = methodScopeOf(r.file);
    const auths = methodAuthOf(r.file);
    for (const verb of r.methods) {
      // A session-only method has no API privilege level to publish, and that
      // is correct rather than missing: no account key can reach it at all, so
      // there is no scope a key could hold. POST /account/keys is the case,
      // gated by an active session plus recent re-authentication. Requiring a
      // level here would have forced a fictional one into the document.
      const allow = auths[verb];
      if (allow && !allow.includes("acct_key")) continue;
      if (!scopes[verb]) ambiguous.push(`${verb.toUpperCase()} ${r.apiPath}`);
    }
  }
  if (ambiguous.length) {
    throw new Error(
      `[gen-openapi] ${ambiguous.length} secured operation(s) enforce no derivable scope level, so their ` +
      `privilege cannot be published truthfully:\n  ${ambiguous.join("\n  ")}\n` +
      `Add requireScopeLevel(...) or a scopeLevel option to each handler.`,
    );
  }

  spec.tags = [...new Set(Object.values(spec.paths).flatMap((i) =>
    VERBS.filter((v) => i[v]).flatMap((v) => i[v].tags)))].sort().map((name) => ({ name }));

  return spec;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const spec = build();
  fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + "\n");
  const ops = Object.values(spec.paths).reduce(
    (n, i) => n + VERBS.filter((v) => i[v]).length, 0);
  console.log(`[gen-openapi] ${Object.keys(spec.paths).length} paths, ${ops} operations`);
}
