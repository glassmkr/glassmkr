// Time constants shared by the cross-snapshot library and its consumers.
// Replaces the two DAY redeclarations that lived in trend-warnings/features.ts
// (one per IPMI/network section). Scout report §5.4.

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function floorToMinute(timestampMs: number): number {
  return Math.floor(timestampMs / MINUTE_MS) * MINUTE_MS;
}

export function floorToSnapshotInterval(
  timestampMs: number,
  intervalSeconds: number,
): number {
  const intervalMs = intervalSeconds * 1000;
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}
