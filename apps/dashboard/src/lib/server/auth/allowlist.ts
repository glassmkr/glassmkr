// Mass-assignment defence for POST/PATCH bodies.
//
// Spec Part 1, threat A5 (BOPLA / mass assignment): a customer sends
// `{"hostname": "foo", "account_id": "other_account"}` and tries to
// write that account_id straight to the DB. Defence: every endpoint
// declares an explicit allowlist of accepted body fields; everything
// else is dropped at the edge.
//
// This is the helper that does the dropping. Routes call:
//
//   const fields = pickAllowedFields(rawBody, ["hostname", "name", "tags"]);
//
// Then validate `fields` further (with zod or hand-coded checks) and
// pass it to the SQL INSERT/UPDATE. There is no "automatic mapping"
// from body to row — every column written is named explicitly.

/**
 * Return a copy of `body` containing ONLY the keys listed in `allowed`.
 * Unknown keys are silently dropped. Null/undefined keys preserve their
 * presence semantics.
 *
 * Defence-in-depth: the allowlist is the second line. The first line is
 * having no `db.<table>.create({ data: rawBody })` patterns anywhere in
 * the codebase. The CI lint rule from PR #7 enforces that.
 */
export function pickAllowedFields<T extends string>(
  body: unknown,
  allowed: readonly T[],
): Record<T, unknown> {
  const out = {} as Record<T, unknown>;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return out;
  }
  const obj = body as Record<string, unknown>;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

/**
 * Strict variant: throws if `body` contains any key NOT in `allowed`.
 * Use when you want loud failures on unexpected fields (e.g. dev/test
 * environments). Production routes should prefer pickAllowedFields,
 * which silently drops, to avoid leaking the field allowlist via error
 * messages.
 *
 * @internal
 */
export function pickAllowedFieldsStrict<T extends string>(
  body: unknown,
  allowed: readonly T[],
): Record<T, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("body must be a non-array object");
  }
  const obj = body as Record<string, unknown>;
  const allowedSet = new Set(allowed as readonly string[]);
  const extras: string[] = [];
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) extras.push(key);
  }
  if (extras.length > 0) {
    throw new Error(`unexpected fields: ${extras.join(", ")}`);
  }
  return pickAllowedFields(body, allowed);
}
