// Drive-failure tree ranker (Stage 2.5).
//
// Loads a LightGBM model (trained offline on Backblaze public data) from an
// ONNX artifact committed to apps/dashboard/models/. At runtime, scores each
// drive-related Finding and adjusts its severity tier: strong disagreement
// (score < 0.1 on a high-severity finding) demotes to medium; strong
// agreement (score > 0.7 on a medium finding) promotes to high. The tree
// never suppresses a finding entirely and its raw score is never shown
// to users.
//
// If the model file is missing or onnxruntime-node cannot load (for example
// on a dev machine without the native binary), this module silently
// disables and returns null scores. Callers MUST tolerate null output and
// fall back to the deterministic tier.
//
// Spec: 07-trend-warnings-spec-v2.md, Stage 2.5.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DriveFeatures, Finding, ServerFeatures } from "./types";

interface TreeRankerMetadata {
  model_version: string;
  feature_names: string[];
  default_model_afr: number;
  model_id_map?: Record<string, number>;
  validation_metrics?: { auroc?: number };
  [k: string]: unknown;
}

let sessionPromise: Promise<any | null> | null = null;
let metadata: TreeRankerMetadata | null = null;
let afrTable: Record<string, number> | null = null;

// Resolve the models directory in a way that works in BOTH the dev
// shell (vite, files served from src/) and the adapter-node production
// bundle (files served from build/server/chunks/<hash>.js).
//
// Pre-fix this used `path.dirname(fileURLToPath(import.meta.url))` plus
// "../../../../models", which resolved to apps/dashboard/models in dev (4
// hops from src/lib/server/trend-warnings/) but in the production
// bundle the same 4 hops landed outside apps/dashboard entirely, so
// loadOnce silently caught ENOENT and disabled the ranker. The model
// artefacts (.onnx, .json) are not copied into build/, so the runtime
// has to reach the source repo on disk. Both dev and the prod systemd
// unit set the working directory to apps/dashboard, so `process.cwd()`
// resolves correctly; DASHBOARD_MODELS_DIR overrides for non-standard
// layouts (containers, alternative deploy shapes).
// Codex 2026-05-12 P1.
const REPO_MODELS_DIR = process.env.DASHBOARD_MODELS_DIR
  ? path.resolve(process.env.DASHBOARD_MODELS_DIR)
  : path.resolve(process.cwd(), "models");
const ONNX_PATH = path.join(REPO_MODELS_DIR, "drive-failure-lightgbm-v1.onnx");
const METADATA_PATH = path.join(REPO_MODELS_DIR, "drive-failure-lightgbm-v1.metadata.json");
const AFR_PATH = path.join(REPO_MODELS_DIR, "drive-model-afr-v1.json");

async function loadOnce(): Promise<any | null> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      const [metaRaw, afrRaw] = await Promise.all([
        readFile(METADATA_PATH, "utf-8"),
        readFile(AFR_PATH, "utf-8").catch(() => "{}"),
      ]);
      metadata = JSON.parse(metaRaw);
      afrTable = JSON.parse(afrRaw);

      const ort = await import("onnxruntime-node").catch(() => null);
      if (!ort) {
        console.warn("[trend-warnings] onnxruntime-node not installed; tree ranker disabled");
        return null;
      }
      const session = await ort.InferenceSession.create(ONNX_PATH);
      warnOnFeatureDrift(metadata?.feature_names ?? []);
      console.log(`[trend-warnings] tree ranker loaded (${metadata?.model_version ?? "unknown"}) from ${REPO_MODELS_DIR}`);
      return { ort, session };
    } catch (err: any) {
      // Include the resolved path so a "ranker disabled" line in prod
      // tells the operator immediately whether to fix the env var or
      // chase a different cause (e.g., missing onnxruntime-node).
      console.warn(`[trend-warnings] tree ranker unavailable from ${REPO_MODELS_DIR}: ${err?.message ?? err}`);
      return null;
    }
  })();
  return sessionPromise;
}

export function getAfrForModel(model: string | undefined): number {
  if (!model) return metadata?.default_model_afr ?? 0.015;
  return afrTable?.[model] ?? metadata?.default_model_afr ?? 0.015;
}

function buildFeatureVector(
  drive: DriveFeatures,
  featureNames: string[]
): Float32Array {
  const afr = getAfrForModel(drive.model);
  const modelId = metadata?.model_id_map?.[drive.model ?? ""] ?? 0;
  const out = new Float32Array(featureNames.length);
  for (let i = 0; i < featureNames.length; i++) {
    const name = featureNames[i];
    out[i] = lookupFeature(name, drive, afr, modelId);
  }
  return out;
}

function lookupFeature(
  name: string,
  drive: DriveFeatures,
  afr: number,
  modelId: number
): number {
  if (name === "model_afr_prior") return afr;
  if (name === "model_id") return modelId;

  const v = (drive as any)[name];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Score a drive-level finding with the tree ranker. Returns a probability
 * in [0, 1] representing the model's estimated risk, or null if the model
 * is unavailable.
 */
export async function scoreDriveRisk(
  finding: Finding,
  features: ServerFeatures
): Promise<number | null> {
  if (finding.resource.kind !== "drive" && finding.resource.kind !== "nvme") {
    return null;
  }
  const loaded = await loadOnce();
  if (!loaded || !metadata) return null;

  const drive = features.drives.find(
    (d) => d.serial === finding.resource.serial || d.device === finding.resource.name
  );
  if (!drive) return null;

  const vec = buildFeatureVector(drive, metadata.feature_names);
  try {
    const { ort, session } = loaded;
    const tensor = new ort.Tensor("float32", vec, [1, vec.length]);
    const inputName = session.inputNames[0] ?? "input";
    const output = await session.run({ [inputName]: tensor });
    return extractProbability(output);
  } catch (err: any) {
    console.warn(`[trend-warnings] tree ranker inference failed: ${err?.message ?? err}`);
    return null;
  }
}

function extractProbability(output: Record<string, any>): number | null {
  // LightGBM via onnxmltools emits a labels tensor and a probability map
  // (array of {0: p0, 1: p1}). onnxruntime-node exposes the ZipMap output
  // as an array. Try common shapes.
  for (const val of Object.values(output)) {
    const data = (val as any)?.data ?? val;
    if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object") {
      const row = data[0] as Record<number | string, number>;
      if (1 in row) return Number(row[1]);
      if ("1" in row) return Number(row["1"]);
      const vals = Object.values(row);
      if (vals.length >= 2) return Number(vals[1]);
      if (vals.length === 1) return Number(vals[0]);
    }
    if (data instanceof Float32Array || data instanceof Float64Array || Array.isArray(data)) {
      const arr = Array.from(data as ArrayLike<number>);
      if (arr.length === 2) return Number(arr[1]);
      if (arr.length === 1) return Number(arr[0]);
    }
  }
  return null;
}

/**
 * Apply tree-ranker adjustments to a list of findings. Mutates
 * `finding.tree_ranker_score` and may adjust `finding.severity`.
 */
export async function applyTreeRanker(
  findings: Finding[],
  features: ServerFeatures
): Promise<Finding[]> {
  for (const finding of findings) {
    if (finding.resource.kind !== "drive" && finding.resource.kind !== "nvme") continue;
    const score = await scoreDriveRisk(finding, features);
    finding.tree_ranker_score = score;
    if (score == null) continue;
    // Tier adjustment rules (spec Stage 2.5)
    if (finding.severity === "high" && score < 0.1) finding.severity = "medium";
    else if (finding.severity === "medium" && score > 0.7) finding.severity = "high";
  }
  return findings;
}

// Names the runtime knows how to fill. Keep in sync with extractDriveFeatures
// in features.ts and the training pipeline's feature_order.json. Anything
// else in the model's feature_names list silently becomes a zero-valued
// feature at inference time, which can shift scores systematically.
const KNOWN_RUNTIME_FEATURES: ReadonlySet<string> = new Set([
  "model_id", "model_afr_prior", "drive_age_days",
  ...["smart_5", "smart_187", "smart_188", "smart_189", "smart_197", "smart_198"].flatMap((s) => [
    `${s}_raw`,
    `${s}_delta_1d`, `${s}_delta_7d`, `${s}_delta_30d`,
    `${s}_burst_max_7d`,
  ]),
]);

function warnOnFeatureDrift(featureNames: string[]): void {
  const missing = featureNames.filter((n) => !KNOWN_RUNTIME_FEATURES.has(n));
  if (missing.length > 0) {
    console.warn(
      `[trend-warnings] tree ranker metadata references ${missing.length} feature(s) not filled by the runtime: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}. These will be scored as zero.`
    );
  }
}

// Exposed for tests
export function __internal_reset(): void {
  sessionPromise = null;
  metadata = null;
  afrTable = null;
}
