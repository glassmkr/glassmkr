// Timeseries primitives shared by trend-warnings and the alert evaluator.
//
// Extracted from apps/dashboard/src/lib/server/trend-warnings/features.ts
// per CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §1.5.
//
// All functions are pure. No DB calls. No clock reads except where
// documented (largestPositiveStepInWindow uses Date.now() to anchor
// the window to "now" — same as the original burstMax closure).

import { DAY_MS } from "./time.js";
import type {
  CrossingResult,
  ProjectionResult,
  RateResult,
  TimeseriesPoint,
} from "./types.js";

/**
 * Ordinary-least-squares linear regression over an array of {t, v}
 * points. Returns slope-per-day plus, when crossingThreshold is
 * provided, the projected unix-ms timestamp when the line crosses
 * the threshold (in the future of the latest point only).
 *
 * Less than 2 points: slope 0, crosses null. Degenerate denominator
 * (all t equal): slope 0, crosses null.
 */
export function linearProjection(
  points: TimeseriesPoint[],
  crossingThreshold?: number,
): ProjectionResult {
  if (points.length < 2) {
    return { slope_per_day: 0, crosses_at_ms: null };
  }

  const n = points.length;
  let sumT = 0;
  let sumV = 0;
  let sumTV = 0;
  let sumTT = 0;
  for (const p of points) {
    sumT += p.t;
    sumV += p.v;
    sumTV += p.t * p.v;
    sumTT += p.t * p.t;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return { slope_per_day: 0, crosses_at_ms: null };

  const slopePerMs = (n * sumTV - sumT * sumV) / denom;
  const interceptV = (sumV - slopePerMs * sumT) / n;
  const slopePerDay = slopePerMs * DAY_MS;

  let crossesAtMs: number | null = null;
  if (crossingThreshold !== undefined && slopePerMs !== 0) {
    // threshold = slopePerMs * t + interceptV
    //   =>  t = (threshold - intercept) / slope
    const t = (crossingThreshold - interceptV) / slopePerMs;
    // Only meaningful if the crossing is in the future of the latest
    // point. Past crossings (line already crossed before window end)
    // are not surfaced; callers needing that should check the latest v
    // against the threshold directly.
    const latestT = points[points.length - 1]!.t;
    if (t > latestT) crossesAtMs = Math.round(t);
  }

  return { slope_per_day: slopePerDay, crosses_at_ms: crossesAtMs };
}

/**
 * Thin wrapper exposing slope as a rate. Distinct name because alert-
 * side rules (e.g. swap_high pswpin/s) read more naturally as
 * "rate of change" than "projection".
 */
export function rateOfChange(points: TimeseriesPoint[]): RateResult {
  const projection = linearProjection(points);
  return {
    rate_per_day: projection.slope_per_day,
    rate_per_second: projection.slope_per_day / 86_400,
  };
}

/**
 * Returns the FIRST point at which the series crosses the threshold
 * in the requested direction. If the series is already on the wrong
 * side of the threshold at the start (no transition), returns null.
 *
 * Subsequent crossings within the same series are not surfaced;
 * consumers that need every crossing can iterate themselves.
 */
export function thresholdCrossing(
  points: TimeseriesPoint[],
  threshold: number,
  direction: "above" | "below" = "above",
): CrossingResult | null {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const wasOnStartSide =
      direction === "above" ? prev.v <= threshold : prev.v >= threshold;
    const crossed =
      direction === "above" ? curr.v > threshold : curr.v < threshold;
    if (wasOnStartSide && crossed) {
      return { first_crossed_at_ms: curr.t, value_at_crossing: curr.v };
    }
  }
  return null;
}

/**
 * Returns the point closest to targetMs by absolute time difference.
 * When toleranceMs is supplied, returns null if the closest point is
 * farther than the tolerance.
 *
 * Replaces the per-call closures in features.ts (drive history,
 * IPMI 14d/7d refs, network 7d ref).
 */
export function findNearestByTime(
  points: TimeseriesPoint[],
  targetMs: number,
  toleranceMs?: number,
): TimeseriesPoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  for (const p of points) {
    if (Math.abs(p.t - targetMs) < Math.abs(best.t - targetMs)) best = p;
  }
  if (toleranceMs !== undefined && Math.abs(best.t - targetMs) > toleranceMs) {
    return null;
  }
  return best;
}

/**
 * Largest positive single-step delta within the window ending at now.
 * Generalises the SMART burstMax closure (features.ts:179-188) — each
 * step is point[i].v - point[i-1].v; negative deltas are ignored.
 *
 * windowSeconds is anchored to Date.now() to match the original
 * closure's behavior; pass an explicit reference clock if the future
 * brings frozen-clock tests.
 */
export function largestPositiveStepInWindow(
  points: TimeseriesPoint[],
  windowSeconds: number,
): number {
  const cutoff = Date.now() - windowSeconds * 1000;
  const inWindow = points.filter((p) => p.t >= cutoff);
  let max = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const delta = inWindow[i]!.v - inWindow[i - 1]!.v;
    if (delta > max) max = delta;
  }
  return max;
}
