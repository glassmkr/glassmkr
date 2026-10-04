// Identifiers copied out of a paste (device paths, models, serials, pool and
// vdev names, sensor names, PCI addresses) end up in rule titles, evidence and
// fix text. Restricting them to a narrow charset at parse time keeps that text
// inert as data: no quotes, no "$", ";", "|", "&", "<", ">", backticks or
// braces, no newlines, no markup. Free-text fields keep letters and spaces but
// are short. Both charsets still keep "(", ")", ":" and "#", which a shell
// reads as syntax (a zsh glob qualifier), so these values are not safe shell
// words: analyze.ts lets only a narrower token into a fix command (R4-2).

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
