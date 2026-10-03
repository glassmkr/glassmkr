// Identifiers copied out of a paste (device paths, models, serials, pool and
// vdev names, sensor names, PCI addresses) end up interpolated into rule
// titles, evidence and fix commands. Restricting them to a narrow charset at
// parse time keeps that text inert: no shell metacharacters, no quotes, no
// newlines, no markup. Free-text fields keep letters and spaces but are short.

const IDENT_DROP = /[^A-Za-z0-9._:/#()+-]/g;
const LABEL_DROP = /[^A-Za-z0-9 ._:/#()+,-]/g;

/** Strict identifier: device paths, serials, pool / vdev / array names, PCI BDFs. */
export function safeIdent(value: unknown, max = 64): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(IDENT_DROP, "").slice(0, max);
}

/** Short human label: drive models, sensor names, SEL event descriptions. */
export function safeLabel(value: unknown, max = 64): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(LABEL_DROP, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
