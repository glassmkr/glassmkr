// THE canonical priority model. One definition, imported everywhere.
//
// Before this file, the tier list was written out by hand in at least six
// places: the channel UI's toggle metadata, its create default, its edit
// default, its badge fallback, the POST validator, the PUT validator, and both
// dispatchers. They did not agree. The UI and both validators offered P1
// through P4, so P0 could not be selected and an explicitly requested P0 was
// filtered out, while the alert dispatcher defaulted to P0 through P3. A tier
// that three rules use had no way into a channel, and a tier that no rule uses
// was the only one every surface agreed on.
//
// Anything that needs to know what the tiers are imports from here.

export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";

export type PriorityMeta = {
  key: Priority;
  /** Shown on toggles and badges. */
  label: string;
  /** One line an operator can act on, used in docs generation and tooltips. */
  meaning: string;
  /** Design token, never a literal. */
  color: string;
  /**
   * Whether a channel receives this tier unless the operator says otherwise.
   *
   * P4 is deliberately OFF. getPriority assigns P4 to an info-severity
   * instance precisely so it appears on the dashboard WITHOUT paging, and
   * priority.test.ts asserts that it "sits below the default notify
   * threshold". Enabling it by default would page on exactly the instances the
   * tier exists to keep quiet.
   */
  defaultEnabled: boolean;
};

export const PRIORITIES: readonly PriorityMeta[] = [
  {
    key: "P0",
    label: "P0 Critical",
    meaning: "Data is already at risk. Uncorrected memory and GPU errors.",
    color: "var(--red)",
    defaultEnabled: true,
  },
  {
    key: "P1",
    label: "P1 Urgent",
    meaning: "Data loss or service outage. Act now.",
    color: "var(--red)",
    defaultEnabled: true,
  },
  {
    key: "P2",
    label: "P2 High",
    meaning: "Significant degradation.",
    color: "var(--yellow)",
    defaultEnabled: true,
  },
  {
    key: "P3",
    label: "P3 Medium",
    meaning: "Early warning.",
    color: "var(--accent)",
    defaultEnabled: true,
  },
  {
    key: "P4",
    label: "P4 Low",
    meaning:
      "Proactive recommendation, or an alert whose instance severity is informational. Shows on the dashboard without paging.",
    color: "var(--blue)",
    defaultEnabled: false,
  },
] as const;

/** Every tier a channel may store. Order is most to least serious. */
export const ALL_PRIORITIES: readonly Priority[] = PRIORITIES.map((p) => p.key);

/**
 * What a channel receives when the operator has not chosen: P0 through P3.
 *
 * This is the "default notify threshold" the priority tests name. It is the
 * same list the alert dispatcher already fell back to, so the UI now agrees
 * with the dispatcher instead of contradicting it.
 */
export const DEFAULT_PRIORITIES: readonly Priority[] = PRIORITIES.filter(
  (p) => p.defaultEnabled,
).map((p) => p.key);

/**
 * A record keyed by tier, for the UI's checkbox state.
 *
 * Takes readonly string[] rather than Priority[] because it is fed by stored
 * channel rows and by expandChannelPriorities, neither of which is typed to the
 * canonical union. Unknown values are simply absent from the result.
 */
export function priorityRecord(enabled: readonly string[]): Record<Priority, boolean> {
  return Object.fromEntries(ALL_PRIORITIES.map((k) => [k, enabled.includes(k)])) as Record<
    Priority,
    boolean
  >;
}

/** Narrow an untrusted list to real tiers, preserving canonical order. */
export function validPriorities(input: unknown): Priority[] {
  if (!Array.isArray(input)) return [];
  return ALL_PRIORITIES.filter((k) => input.includes(k));
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (ALL_PRIORITIES as readonly string[]).includes(value);
}
