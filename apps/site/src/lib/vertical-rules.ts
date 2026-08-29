// Per-vertical rule counts, derived from the generated catalogue.
//
// The vertical pages each stated a count in words: "Sixteen rules for the
// storage layer", "Forty-five rules apply to an ordinary compute box", "Nine
// rules read the GPUs. The other sixty-one still apply." All three were
// correct when checked against the catalogue, and all three were literals that
// nothing would have corrected on the day a rule landed. The house rule is that
// a rule count is never written down, and spelled-out numbers were slipping
// through the guard that enforces it because the guard looked for digits.
//
// Which categories belong to which vertical is a real editorial decision and
// lives here, once, rather than being implied by a number on a page.
import rules from "$lib/data/rules.json";

const VERTICAL_CATEGORIES: Record<string, string[]> = {
  storage: ["Storage", "Filesystem", "ZFS"],
  compute: ["Network", "Hardware (BMC/IPMI)", "Security & Patching", "Memory & CPU", "Time & Services"],
  gpu: ["GPU"],
};

export function ruleCountFor(vertical: keyof typeof VERTICAL_CATEGORIES | string): number {
  const cats = VERTICAL_CATEGORIES[vertical];
  if (!cats) throw new Error(`unknown vertical: ${vertical}`);
  return rules.filter((r: { _category?: string }) => cats.includes(r._category ?? "")).length;
}

export const totalRuleCount = rules.length;

// English words for small numbers, because the pages read better in prose than
// with a numeral mid-sentence and the point is to stop the number being a
// literal, not to change the voice.
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function inWords(n: number): string {
  if (n < 0 || n > 99 || !Number.isInteger(n)) return String(n);
  if (n < 20) return WORDS[n];
  const t = TENS[Math.floor(n / 10)];
  const u = n % 10;
  return u ? `${t}-${WORDS[u]}` : t;
}

export function inWordsCapitalized(n: number): string {
  const w = inWords(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
