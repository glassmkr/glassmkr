import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Audit finding 7: MCP tool contracts.
//
// The audit classified this "unverified" because it did not authorize an MCP
// client, and I repeated that classification without acting on it, which turned
// "not yet tested" into "not on the list". These are the properties a client
// relies on when deciding whether it may call a tool without asking a human.
//
// Read statically from the registration source rather than by standing up a
// server, because what matters here is the DECLARATION: a client reads the tool
// catalogue and decides from it. Behaviour is covered by gateway.test.ts and
// the scope tests alongside this file.
const SRC = fs.readFileSync(
  path.join(__dirname, "..", "server.ts"),
  "utf8",
);

/** Every registerTool("name", { ... }) block, as name plus its options text. */
function registrations(): Array<{ name: string; options: string }> {
  const out: Array<{ name: string; options: string }> = [];
  const re = /server\.registerTool\(\s*"([^"]+)"\s*,\s*\{/g;
  let m;
  while ((m = re.exec(SRC))) {
    // Walk braces from the options object to find its end.
    let depth = 1;
    let i = re.lastIndex;
    while (i < SRC.length && depth > 0) {
      if (SRC[i] === "{") depth++;
      else if (SRC[i] === "}") depth--;
      i++;
    }
    out.push({ name: m[1], options: SRC.slice(re.lastIndex, i) });
  }
  return out;
}

const tools = registrations();

/** The handler body that follows a tool's options object. */
function handlerOf(name: string) {
  const i = SRC.indexOf(`server.registerTool(\n    "${name}"`);
  const start = i === -1 ? SRC.indexOf(`"${name}"`) : i;
  return SRC.slice(start, start + 1200);
}

describe("every MCP tool declares a usable contract", () => {
  it("registers at least the documented tool set", () => {
    // A guard against this whole file silently passing because the regex
    // stopped matching after a refactor.
    expect(tools.length).toBeGreaterThanOrEqual(8);
  });

  it("every tool has a title and a description", () => {
    const bad = tools.filter((t) => !/title:/.test(t.options) || !/description:/.test(t.options));
    expect(bad.map((t) => t.name)).toEqual([]);
  });

  it("every tool that takes parameters declares an input schema", () => {
    // A tool with no parameters legitimately omits it: host_profiles.list takes
    // nothing, and an empty schema would be noise. What must not happen is a
    // tool whose handler destructures arguments without declaring them, so the
    // check pairs the two.
    const bad = tools.filter(
      (t) => !/inputSchema:/.test(t.options) && !/^\s*async \(\)/m.test(handlerOf(t.name)),
    );
    expect(bad.map((t) => t.name)).toEqual([]);
  });

  it("every tool declares an output schema, so structuredContent can be validated", () => {
    const bad = tools.filter((t) => !/outputSchema:/.test(t.options));
    expect(bad.map((t) => t.name)).toEqual([]);
  });

  it("every tool points at an annotation set", () => {
    // Annotations are hints for the CLIENT, not authorization: the server
    // enforces regardless. But a missing destructiveHint means a client cannot
    // decide whether to prompt a human, which is the whole point of them.
    const bad = tools.filter((t) => !/annotations:\s*\w+Annotations/.test(t.options));
    expect(bad.map((t) => t.name)).toEqual([]);
  });

  it("every annotation set defines all four hints", () => {
    // The tools reference these by name, so an incomplete set would leave every
    // tool using it silently missing a hint.
    const sets = [...SRC.matchAll(/const (\w+Annotations) = \{([^}]*)\}/g)];
    expect(sets.length).toBeGreaterThanOrEqual(3);
    const bad: string[] = [];
    for (const [, name, body] of sets) {
      for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        if (!new RegExp(`${k}\\s*:`).test(body)) bad.push(`${name}: ${k}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("destructive tools are marked as such", () => {
  it("the delete tool uses the destructive annotation set", () => {
    const del = tools.find((t) => t.name.includes("delete_server"));
    expect(del).toBeTruthy();
    expect(del!.options).toMatch(/annotations:\s*adminDestructiveAnnotations/);
  });

  it("no tool named purge exists on the MCP surface", () => {
    // Permanent destruction is deliberately unreachable from MCP. If a purge
    // tool is ever added this fails, forcing that to be a reviewed decision
    // rather than a quiet one.
    expect(tools.filter((t) => /purge/i.test(t.name))).toEqual([]);
  });
});
