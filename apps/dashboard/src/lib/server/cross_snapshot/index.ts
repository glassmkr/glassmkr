// Public surface for the cross-snapshot library.
//
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §1.8.
//
// Two consumers in v1:
//   - apps/dashboard/src/lib/server/trend-warnings/features.ts
//     (Phase 1 migration; uses readWindow + timeseries primitives).
//   - apps/dashboard/src/lib/server/alerts/ingest path
//     (Phase 2; opt-in pre-pass + parsed: true readWindow).
//
// Library scope is locked small per the spec's decision 1. Statistical
// methods (Holt-Winters, Mann-Kendall, anomaly scoring) are explicitly
// out of scope; if a future rule needs them, add via a separate spec.

export { readWindow } from "./read_window.js";

export {
  linearProjection,
  rateOfChange,
  thresholdCrossing,
  findNearestByTime,
  largestPositiveStepInWindow,
} from "./timeseries.js";

export { correlatedRulesActive } from "./correlation.js";
export type { QueryExec } from "./correlation.js";

export { runPrePass } from "./pre_pass.js";
export type {
  CrossSnapshotRulePayload,
  RunPrePassDeps,
} from "./pre_pass.js";

export {
  SECOND_MS,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  floorToMinute,
  floorToSnapshotInterval,
} from "./time.js";

export { safeParse } from "./_parse.js";

export type {
  CorrelationResult,
  CrossingResult,
  ProjectionResult,
  RateResult,
  ReadWindowOptions,
  SnapshotColumn,
  SnapshotCountWindow,
  SnapshotRow,
  TimeWindow,
  TimeseriesPoint,
} from "./types.js";

// Test-only export.
export { _clearCacheForTests } from "./cache.js";
