// The output schema each tool advertises at tools/list, opened for additions.
//
// A client caches that schema and validates every later result against it:
// the MCP SDK's Client compiles an Ajv validator per tool at listTools() and
// rejects a result that does not match ("Structured content does not match
// the tool's output schema"), and ChatGPT keeps the last approved definition
// live while a rescan holds an update. Advertised closed (additionalProperties
// false at every level, closed enums, a constant docs_url), any additive
// change (a new format, subject kind or field) failed every call in a session
// opened before the deploy (R4-7).
//
// The strict zod objects stay the server's own contract: the tests parse every
// result with them, so an undeclared key still fails a gate here. What a
// client is told is the same shape with objects open to keys they do not list,
// and enums and literals as strings whose description names today's values.

import { z, type ZodTypeAny } from "zod";

function describe<T extends ZodTypeAny>(schema: T, ...parts: Array<string | undefined>): T {
  const text = parts.filter(Boolean).join(" ");
  return text ? schema.describe(text) : schema;
}

/** `schema` with every object passthrough and every enum or string literal a described string. */
export function advertisedSchema(schema: ZodTypeAny): ZodTypeAny {
  const own = schema.description;
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, value] of Object.entries(schema.shape as Record<string, ZodTypeAny>)) shape[key] = advertisedSchema(value);
    return describe(z.object(shape).passthrough(), own);
  }
  if (schema instanceof z.ZodArray) return describe(z.array(advertisedSchema(schema.element)), own);
  // A wrapper's description replaces its inner one in the JSON Schema, so the
  // inner one (an enum's value list) is carried up.
  if (schema instanceof z.ZodOptional) {
    const inner = advertisedSchema(schema.unwrap());
    return describe(inner.optional(), own, inner.description);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = advertisedSchema(schema.unwrap());
    return describe(inner.nullable(), own, inner.description);
  }
  if (schema instanceof z.ZodRecord) return describe(z.record(advertisedSchema(schema.valueSchema)), own);
  if (schema instanceof z.ZodUnion) {
    const options = (schema.options as ZodTypeAny[]).map(advertisedSchema) as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]];
    return describe(z.union(options), own);
  }
  if (schema instanceof z.ZodEnum) {
    return describe(z.string(), own, `One of: ${(schema.options as string[]).join(", ")}. Later versions may add values.`);
  }
  if (schema instanceof z.ZodLiteral && typeof schema.value === "string") {
    return describe(z.string(), own, `Currently ${schema.value}`);
  }
  return schema;
}
