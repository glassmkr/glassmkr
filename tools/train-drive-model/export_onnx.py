"""Convert the trained LightGBM model to ONNX and verify numerical agreement.

Uses polars streaming to pull a random sample (without loading the full
frame into memory) and builds the feature vector in the same order the
runtime will use (including model_id and model_afr_prior).
Agreement tolerance: absolute difference < 1e-5.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import polars as pl
import lightgbm as lgb
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
REPO_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_ROOT / "apps" / "forge" / "models"
MODEL_PATH = DATA_DIR / "lightgbm-raw.txt"
FEATURE_ORDER_PATH = DATA_DIR / "feature_order.json"
MODEL_ID_MAP_PATH = DATA_DIR / "model_id_map.json"
AFR_PATH = MODELS_DIR / "drive-model-afr-v1.json"
ONNX_PATH = MODELS_DIR / "drive-failure-lightgbm-v1.onnx"
DEFAULT_AFR = 0.015
SAMPLE_ROWS = int(os.environ.get("PARITY_SAMPLE", "512"))


def main() -> None:
    if not MODEL_PATH.exists():
        raise SystemExit(f"{MODEL_PATH} not found; run train.py first")

    model = lgb.Booster(model_file=str(MODEL_PATH))
    feature_order = json.loads(FEATURE_ORDER_PATH.read_text())
    assert model.num_feature() == len(feature_order), (
        f"feature count mismatch: model={model.num_feature()} "
        f"feature_order.json={len(feature_order)}"
    )

    initial_type = [("input", FloatTensorType([None, len(feature_order)]))]
    onnx_model = convert_lightgbm(model, initial_types=initial_type)
    ONNX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(ONNX_PATH, "wb") as f:
        f.write(onnx_model.SerializeToString())
    print(f"[save] {ONNX_PATH} ({ONNX_PATH.stat().st_size // 1024} KB)", flush=True)

    try:
        import onnxruntime as ort
    except ImportError:
        print("[warn] onnxruntime not installed, skipping parity check", flush=True)
        return

    # Sample rows via polars lazy + stride; cheap and avoids loading the frame.
    afr_map = json.loads(AFR_PATH.read_text()) if AFR_PATH.exists() else {}
    model_id_map = json.loads(MODEL_ID_MAP_PATH.read_text()) if MODEL_ID_MAP_PATH.exists() else {}
    native_cols = [c for c in feature_order if c not in {"model_id", "model_afr_prior"}]
    needed = list({*native_cols, "model"})

    # Stride ~ total_rows / SAMPLE_ROWS. Using a safe high stride keeps the
    # sample small; exact size not important for parity.
    stride = 200_000
    sample = (
        pl.scan_parquet(DATA_DIR / "features.parquet")
        .select(needed)
        .with_row_index(name="_i")
        .filter((pl.col("_i") % stride) == 0)
        .drop("_i")
        .head(SAMPLE_ROWS)
        .collect(streaming=True)
    )

    sample = sample.with_columns([
        pl.col("model").map_elements(lambda m: afr_map.get(m, DEFAULT_AFR), return_dtype=pl.Float32).alias("model_afr_prior"),
        pl.col("model").map_elements(lambda m: model_id_map.get(m, 0), return_dtype=pl.Int32).alias("model_id"),
    ])
    for c in feature_order:
        if c not in sample.columns:
            sample = sample.with_columns(pl.lit(0, dtype=pl.Float32).alias(c))
    sample = sample.with_columns([pl.col(c).fill_null(0).cast(pl.Float32) for c in feature_order])

    X = sample.select(feature_order).to_numpy().astype(np.float32)
    if X.shape[0] == 0:
        print("[warn] empty parity sample; skipping", flush=True)
        return

    lgb_scores = model.predict(X)
    sess = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    outputs = sess.run(None, {sess.get_inputs()[0].name: X})

    onnx_scores = None
    for out in outputs:
        if isinstance(out, list) and out and isinstance(out[0], dict):
            onnx_scores = np.array(
                [row.get(1, next(iter(row.values()))) for row in out], dtype=np.float64
            )
            break
        if isinstance(out, np.ndarray) and out.ndim == 2 and out.shape[1] >= 2:
            onnx_scores = out[:, 1]
            break
    if onnx_scores is None:
        print("[warn] could not locate probability output in ONNX run", flush=True)
        return

    max_abs_diff = float(np.max(np.abs(lgb_scores - onnx_scores)))
    print(f"[parity] n={X.shape[0]}  max |lgb - onnx| = {max_abs_diff:.3e}", flush=True)
    if max_abs_diff >= 1e-5:
        print("[FAIL] ONNX predictions diverge from LightGBM beyond 1e-5", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
