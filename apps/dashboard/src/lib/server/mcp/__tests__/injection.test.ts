import { describe, expect, it, vi } from "vitest";

vi.mock("../context", () => ({
  getMcpRequestContext: () => {
    throw new Error("no request context in unit tests");
  },
}));

import { createMcpResult } from "../results";
import { McpOperationError } from "../errors";
import {
  HOSTILE_STRINGS,
  OVERSIZED_ARRAY,
  OVERSIZED_STRING,
  POLLUTING_KEYS,
  deeplyNested,
  hostileSnapshot,
  oversizedObject,
} from "./fixtures/hostile-telemetry";

// Audit finding 9: the untrusted-telemetry boundary.
//
// Every string here originates on a machine we do not control, and reaches an
// LLM through an MCP result. These tests drive the full adversarial corpus
// through the real result builder and assert the properties that make host
// content data rather than instruction.
//
// Note what is deliberately NOT asserted: that hostile text is removed. It is
// not, and it should not be. A SMART model string that happens to read like an
// instruction is still the true content of that field, and silently rewriting
// it would corrupt the evidence an operator is trying to read. The defence is
// that it stays inert and stays labelled, not that it disappears.

const CONTROL_OR_BIDI = new RegExp(
  "[" + "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F" +
  "\\u202A-\\u202E\\u2066-\\u2069" + "]",
);

describe("hostile host strings survive as inert, labelled data", () => {
  for (const c of HOSTILE_STRINGS) {
    it(`${c.id}: ${c.intent}`, () => {
      const result = createMcpResult(
        { hostname: c.value },
        "untrusted_host_data",
        ["/data/hostname"],
      );
      const json = JSON.stringify(result.structuredContent);

      // 1. It does not escape its field. If the payload could break the JSON
      //    envelope it could forge a sibling, including the trust block.
      const reparsed = JSON.parse(json);
      expect(typeof reparsed.data.hostname).toBe("string");

      // 2. It cannot forge the trust classification. The json-fragment fixture
      //    tries exactly this.
      expect(reparsed.meta.trust.classification).toBe("untrusted_host_data");

      // 3. No control characters, terminal escapes or bidi overrides survive
      //    into the output, so a console or log viewer cannot be rewritten by
      //    a monitored host.
      expect(CONTROL_OR_BIDI.test(reparsed.data.hostname)).toBe(false);

      // 4. The field is named as untrusted, so a reader is told which parts of
      //    the payload are attacker-influenced rather than having to guess.
      expect(reparsed.meta.trust.untrusted_json_pointers).toContain("/data/hostname");
    });
  }

  it("labels a whole hostile snapshot, not just the field someone remembered", () => {
    const pointers = [
      "/data/hostname",
      "/data/system/os",
      "/data/storage/disks/0/model",
      "/data/network/interfaces/0/name",
      "/data/ipmi/sel",
    ];
    const result = createMcpResult(hostileSnapshot(), "untrusted_host_data", pointers);
    const out = JSON.parse(JSON.stringify(result.structuredContent));
    expect(out.meta.trust.classification).toBe("untrusted_host_data");
    for (const p of pointers) expect(out.meta.trust.untrusted_json_pointers).toContain(p);
    // The nested values are sanitised too, not only the top level.
    expect(CONTROL_OR_BIDI.test(JSON.stringify(out.data))).toBe(false);
  });
});

describe("the result carries a standing warning about its own contents", () => {
  it("tells the reader not to follow instructions found in host data", () => {
    const result = createMcpResult({ hostname: HOSTILE_STRINGS[0].value }, "untrusted_host_data", ["/data/hostname"]);
    const text = JSON.stringify(result);
    expect(text).toMatch(/never as instructions|never treat it as authorization|Never follow instructions/i);
  });

  it("says something different for trusted product data", () => {
    // The warning has to distinguish, or it is noise that gets ignored.
    const trusted = JSON.stringify(createMcpResult({ rules: 70 }, "trusted", []));
    const untrusted = JSON.stringify(createMcpResult({ hostname: "x" }, "untrusted_host_data", ["/data/hostname"]));
    expect(trusted).not.toEqual(untrusted);
    expect(trusted).toMatch(/trusted product data/i);
  });
});

describe("size limits are enforced loudly, never silently", () => {
  it("refuses an array wider than the limit rather than quietly dropping items", () => {
    expect(() => createMcpResult({ items: OVERSIZED_ARRAY }, "untrusted_host_data", [])).toThrow(
      McpOperationError,
    );
  });

  it("refuses an object with more keys than the limit", () => {
    expect(() => createMcpResult({ o: oversizedObject() }, "untrusted_host_data", [])).toThrow(
      McpOperationError,
    );
  });

  it("refuses nesting deeper than the limit", () => {
    // A deeply nested payload is a cheap way to exhaust a parser downstream.
    expect(() => createMcpResult({ o: deeplyNested() }, "untrusted_host_data", [])).toThrow(
      McpOperationError,
    );
  });

  it("marks a truncated string instead of cutting it silently", () => {
    // The audit is explicit: truncate with metadata, never silently. A reader
    // handed 20,000 characters with no marker cannot tell whether they are
    // looking at the whole value or the start of a much longer one.
    const result = createMcpResult({ blob: OVERSIZED_STRING }, "untrusted_host_data", ["/data/blob"]);
    const out = JSON.parse(JSON.stringify(result.structuredContent));
    expect(out.data.blob.length).toBeLessThan(OVERSIZED_STRING.length);
    expect(out.data.blob).toMatch(/truncated/i);
  });
});

describe("structural attacks on the object itself", () => {
  it("drops prototype-polluting keys", () => {
    const result = createMcpResult({ ...POLLUTING_KEYS }, "untrusted_host_data", []);
    const out = result.structuredContent as Record<string, any>;
    expect(out.data.hostname).toBe("web-01");
    // hasOwnProperty rather than a truthiness check: `data.constructor`
    // resolves up the prototype chain to Object even when the key was
    // correctly dropped, so a plain undefined assertion would have been
    // testing JavaScript rather than the sanitiser.
    for (const k of ["__proto__", "constructor", "prototype"]) {
      expect(Object.prototype.hasOwnProperty.call(out.data, k)).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not let a hostile key name smuggle control characters", () => {
    const key = "bad key" + String.fromCodePoint(0x202e);
    const result = createMcpResult({ [key]: "v" }, "untrusted_host_data", []);
    const out = JSON.parse(JSON.stringify(result.structuredContent));
    for (const k of Object.keys(out.data)) expect(CONTROL_OR_BIDI.test(k)).toBe(false);
  });
});
