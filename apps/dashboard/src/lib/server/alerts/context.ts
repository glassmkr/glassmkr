// Alert context enrichment - Phase 1 (Layer A, kind: column only).
//
// For rules whose metric lives in a first-class flat column on
// `glassmkr.snapshots`, this module fetches the last N minutes of
// samples, computes a small summary (current/avg/min/max + linear-
// regression trend over the last 30 min), and renders a plain-text
// block to attach to the outgoing notification.
//
// See CC_ALERT_CONTEXT_ENRICHMENT.md. Only `kind: column` is
// implemented in this phase; `json_scalar` and `json_array_element`
// paths and the sparkline image are deferred to Phase 2 / Phase 3.

import { clickhouse } from "@glassmkr/db/clickhouse";

export type MetricPath =
  | { kind: "column"; column: string };

export interface ContextMetricConfig {
  metric: MetricPath;
  unit: string;                       // rendered alongside each value
  windowMinutes?: number;             // default 120
  trendWindowMinutes?: number;        // default 30
  /** Trend magnitude (per-hour slope) below (noiseFloor * (max-min))
   *  renders as "stable" rather than a numeric slope. */
  trendNoiseFloor?: number;           // default 0.1
  /** How to render a single value. Defaults to Math.round for
   *  integer-like units, 1 decimal for floats. Phase 1 keeps this
   *  simple and per-rule. */
  format?: (v: number) => string;
}

// Per-alert-type config. Phase 1 wires one rule only. Extend in Phase 2.
export const CONTEXT_METRICS: Record<string, ContextMetricConfig> = {
  ram_high: {
    metric: { kind: "column", column: "ram_used_mb" },
    unit: "MB",
    format: (v) => {
      if (v >= 1024) return `${(v / 1024).toFixed(1)} GB`;
      return `${Math.round(v)} MB`;
    },
  },
};

export interface Sample {
  ts: number;   // unix ms
  value: number;
}

export interface ContextSummary {
  samples: Sample[];
  current: number;
  average: number;
  min: number;
  minAt: number;   // unix ms
  max: number;
  maxAt: number;   // unix ms
  /** "stable" when slope magnitude is below the noise floor, else
   *  a per-hour slope (units: value_unit / hour). */
  trend: { kind: "stable" } | { kind: "slope"; perHour: number };
}

/**
 * Pull samples from the `snapshots` table. For `kind: column` we read
 * the flat column directly. Only called from the dispatch path; a
 * ClickHouse outage here must never block an alert.
 */
export async function fetchSamples(
  serverId: string,
  metric: MetricPath,
  windowMinutes: number,
): Promise<Sample[]> {
  if (metric.kind !== "column") {
    throw new Error(`context: unsupported metric kind ${(metric as any).kind}`);
  }
  // Basic SQL-injection guard: the column name is selected from a
  // code-side literal (CONTEXT_METRICS), but validate just in case a
  // future caller routes external input here.
  if (!/^[a-z_][a-z0-9_]*$/.test(metric.column)) {
    throw new Error(`context: invalid column ${JSON.stringify(metric.column)}`);
  }
  const res = await clickhouse.query({
    query: `
      -- clickhouse-lint-allow: metric.column is regex-validated above
      -- (^[a-z_][a-z0-9_]*$) and sourced from the CONTEXT_METRICS code
      -- literal; ClickHouse cannot parameterize a column identifier.
      SELECT toUnixTimestamp64Milli(timestamp) AS ts,
             ${metric.column} AS v
      FROM snapshots
      WHERE server_id = {serverId:String}
        AND timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
      ORDER BY timestamp ASC
    `,
    query_params: { serverId, mins: windowMinutes },
    format: "JSONEachRow",
  });
  const rows = await res.json<{ ts: string | number; v: number }>();
  return rows.map((r) => ({ ts: Number(r.ts), value: Number(r.v) }));
}

/**
 * Summary stats + trend classification. Pure. Trend is computed as a
 * linear regression over the last `trendWindowMinutes` of samples.
 * If fewer than 3 samples exist anywhere in the window, the caller
 * should render an "insufficient history" note instead.
 */
export function computeSummary(
  samples: Sample[],
  opts: { trendWindowMinutes: number; trendNoiseFloor: number },
): ContextSummary | null {
  if (samples.length < 3) return null;
  let min = Infinity, max = -Infinity, minAt = 0, maxAt = 0, sum = 0;
  for (const s of samples) {
    if (s.value < min) { min = s.value; minAt = s.ts; }
    if (s.value > max) { max = s.value; maxAt = s.ts; }
    sum += s.value;
  }
  const average = sum / samples.length;
  const current = samples[samples.length - 1].value;

  // Trend: linear regression on the tail.
  const latestTs = samples[samples.length - 1].ts;
  const cutoff = latestTs - opts.trendWindowMinutes * 60_000;
  const tail = samples.filter((s) => s.ts >= cutoff);
  let trend: ContextSummary["trend"];
  if (tail.length < 2) {
    trend = { kind: "stable" };
  } else {
    // Normalise ts to hours from the first tail sample so slope is
    // directly "units per hour."
    const t0 = tail[0].ts;
    const xs = tail.map((s) => (s.ts - t0) / 3_600_000);
    const ys = tail.map((s) => s.value);
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    // A perfectly flat trace has max === min and so a zero noise floor;
    // using `<=` makes slope == 0 stable in that case rather than
    // rendering "rising at 0/hour."
    const floor = opts.trendNoiseFloor * (max - min);
    trend = Math.abs(slope) <= floor ? { kind: "stable" } : { kind: "slope", perHour: slope };
  }

  return { samples, current, average, min, minAt, max, maxAt, trend };
}

function fmtTime(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Render the text block. Returns the full multi-line string, no
 * leading/trailing blank line. The dispatcher wraps/embeds it.
 */
export function renderContextBlock(
  summary: ContextSummary,
  cfg: ContextMetricConfig,
  windowMinutes: number,
): string {
  const fmt = cfg.format ?? ((v: number) => `${v}${cfg.unit ? " " + cfg.unit : ""}`);
  const unitSuffix = cfg.unit && !cfg.format ? "" : "";
  const hrs = Math.round(windowMinutes / 60);
  const windowLabel = hrs >= 1 ? `${hrs} hour${hrs !== 1 ? "s" : ""}` : `${windowMinutes} min`;
  const lines: string[] = [`Context (last ${windowLabel}):`];
  lines.push(`  current: ${fmt(summary.current)}${unitSuffix}`);
  lines.push(`  average: ${fmt(summary.average)}`);
  lines.push(`  minimum: ${fmt(summary.min)}  at ${fmtTime(summary.minAt)}`);
  lines.push(`  maximum: ${fmt(summary.max)}  at ${fmtTime(summary.maxAt)}`);
  if (summary.trend.kind === "stable") {
    lines.push(`  trend:   stable`);
  } else {
    const dir = summary.trend.perHour >= 0 ? "rising" : "falling";
    const absPerHour = Math.abs(summary.trend.perHour);
    lines.push(`  trend:   ${dir} at ${fmt(absPerHour)}/hour over last 30 min`);
  }
  return lines.join("\n");
}

/**
 * Top-level orchestrator. Returns the rendered text block, or null if
 * this alert type has no context config, or data is insufficient, or
 * the query fails. The dispatcher is responsible for never letting a
 * null here block the notification.
 */
export async function buildContextBlock(
  alertType: string,
  serverId: string,
): Promise<string | null> {
  const cfg = CONTEXT_METRICS[alertType];
  if (!cfg) return null;
  const windowMinutes = cfg.windowMinutes ?? 120;
  const trendWindowMinutes = cfg.trendWindowMinutes ?? 30;
  const trendNoiseFloor = cfg.trendNoiseFloor ?? 0.1;
  let samples: Sample[];
  try {
    samples = await fetchSamples(serverId, cfg.metric, windowMinutes);
  } catch (err: any) {
    console.warn(`[alert-context] fetch failed for ${alertType} on ${serverId}: ${err?.message}`);
    return "Context: unavailable (history query failed).";
  }
  const summary = computeSummary(samples, { trendWindowMinutes, trendNoiseFloor });
  if (!summary) return "Context: insufficient history.";
  return renderContextBlock(summary, cfg, windowMinutes);
}
