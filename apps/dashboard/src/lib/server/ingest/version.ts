// Semver comparison for Crucible update notifications.
// Major releases (X.0.0 or 0.X.0) are mandatory on all channels.
// Patch releases (0.0.X) are opt-in per channel via notify_minor_update.

export function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map(Number);
}

export type ReleaseType = "major" | "patch" | "none";

export function classifyRelease(current: string, latest: string): ReleaseType {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  // Already current or ahead
  if (l[0] < c[0] || (l[0] === c[0] && l[1] < c[1]) || (l[0] === c[0] && l[1] === c[1] && l[2] <= c[2])) return "none";
  // Major or minor bump (X.0.0 or 0.X.0)
  if (l[0] > c[0] || (l[0] === c[0] && l[1] > c[1])) return "major";
  // Patch bump
  if (l[0] === c[0] && l[1] === c[1] && l[2] > c[2]) return "patch";
  return "none";
}

// Legacy compat: old callers that just want a boolean for "should we notify at all?"
export function isNotifiableRelease(current: string, latest: string): boolean {
  return classifyRelease(current, latest) !== "none";
}
