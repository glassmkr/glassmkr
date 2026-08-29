// Hardware vendor display normaliser.
//
// Crucible writes the verbatim /sys/class/dmi/id/sys_vendor string
// into snap.dmi.raw_vendor, which Dashboard stores on servers.dmi_vendor.
// That string varies a lot across vendor SKUs ("GIGABYTE",
// "Gigabyte Technology Co., Ltd.", "Super Micro Computer, Inc."),
// so the dashboard tile and server detail header normalise it to a
// short, human-readable canonical name before display.
//
// Normalisation lives at render time (not at ingest write time) so
// the canonical-name table can be tweaked without a backfill across
// every existing server row.
//
// Unknown vendors fall through to a trimmed-and-suffix-stripped
// version of the raw string. Callers are expected to handle
// empty/null inputs by hiding the line entirely; this helper
// returns "" for those so the call site can use a single
// truthiness check.

const CANONICAL_BY_PREFIX: Array<{ test: (lower: string) => boolean; canonical: string }> = [
  { test: (s) => s.startsWith("gigabyte"), canonical: "GIGABYTE" },
  { test: (s) => s.startsWith("supermicro") || s.startsWith("super micro"), canonical: "Supermicro" },
  { test: (s) => s.startsWith("asrockrack") || s.startsWith("asrock rack"), canonical: "ASRockRack" },
  { test: (s) => s.startsWith("asus") || s.startsWith("asustek"), canonical: "ASUS" },
  { test: (s) => s.startsWith("dell"), canonical: "Dell" },
  { test: (s) => s.startsWith("hpe") || s.startsWith("hewlett packard") || s === "hp" || s.startsWith("hp "), canonical: "HPE" },
  { test: (s) => s.startsWith("lenovo"), canonical: "Lenovo" },
  { test: (s) => s.startsWith("inspur"), canonical: "Inspur" },
];

const TRAILING_SUFFIX_REGEX = /(,?\s+(inc|ltd|co\.|corporation|corp|llc|gmbh|technology co\.,?\s*ltd|computer)\.?)+$/i;

export function normalizeVendor(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const lower = trimmed.toLowerCase();
  for (const entry of CANONICAL_BY_PREFIX) {
    if (entry.test(lower)) return entry.canonical;
  }
  // Fallback: strip common corporate suffixes so "QEMU" / "VMware,
  // Inc." / "Acme, Ltd." display cleanly without forcing every VM
  // host into a hard-coded table.
  return trimmed.replace(TRAILING_SUFFIX_REGEX, "").trim();
}
