"""Train LightGBM binary classifier on the prepared features parquet.

Loads a memory-safe subset (all positives + a random sample of negatives)
using polars' streaming engine. Temporal split: rows with date < SPLIT_DATE
train, rest validate. Model names are label-encoded from the AFR table.
"""
import json
import os
from pathlib import Path

import numpy as np
import polars as pl
import lightgbm as lgb

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
REPO_ROOT = Path(__file__).resolve().parents[2]
AFR_PATH = REPO_ROOT / "apps" / "forge" / "models" / "drive-model-afr-v1.json"

FEATURE_ORDER_PATH = DATA_DIR / "feature_order.json"
MODEL_ID_MAP_PATH = DATA_DIR / "model_id_map.json"
MODEL_PATH = DATA_DIR / "lightgbm-raw.txt"
SPLIT_DATE_STR = os.environ.get("SPLIT_DATE", "2025-07-01")
DEFAULT_AFR = 0.015
# Negative subsample rate. 0.05 keeps ~11M out of ~222M negatives; plenty
# of signal, well under memory budget. Override with NEG_SAMPLE env var.
NEG_SAMPLE = float(os.environ.get("NEG_SAMPLE", "0.05"))
SEED = 42

RAW_SMART = ["smart_5_raw", "smart_187_raw", "smart_188_raw", "smart_189_raw", "smart_197_raw", "smart_198_raw"]


def build_feature_cols() -> list[str]:
    cols = ["model_id", "model_afr_prior", "drive_age_days"] + RAW_SMART
    for col in RAW_SMART:
        name = col.replace("_raw", "")
        cols += [f"{name}_delta_1d", f"{name}_delta_7d", f"{name}_delta_30d", f"{name}_burst_max_7d"]
    return cols


def main() -> None:
    parquet_path = DATA_DIR / "features.parquet"
    if not parquet_path.exists():
        raise SystemExit(f"{parquet_path} not found; run prepare_features.py first")

    afr_map: dict[str, float] = {}
    if AFR_PATH.exists():
        afr_map = json.loads(AFR_PATH.read_text())
    known_models = sorted(afr_map.keys())
    model_id_map = {name: idx + 1 for idx, name in enumerate(known_models)}
    MODEL_ID_MAP_PATH.write_text(json.dumps(model_id_map, indent=2))

    feature_cols = build_feature_cols()

    # Columns we need from parquet (native feature columns, plus auxiliary)
    native_feature_cols = [c for c in feature_cols if c not in {"model_id", "model_afr_prior"}]
    needed = list({*native_feature_cols, "date", "model", "label_fail_within_30d"})

    print(f"[scan] {parquet_path}", flush=True)
    lf = pl.scan_parquet(parquet_path).select(needed)

    # Cast date once for the temporal split (it's already a Date on disk)
    split_date = pl.lit(SPLIT_DATE_STR).str.strptime(pl.Date, "%Y-%m-%d")

    # Positives: keep all. Negatives: deterministic per-row uniform sample.
    # Hashing on a categorical column like `model` would keep/drop whole
    # models at once, biasing the sampled distribution and flipping the
    # learned polarity on validation. Row-index modulo is uniform.
    pos_lf = lf.filter(pl.col("label_fail_within_30d") == 1)
    stride = max(int(round(1.0 / NEG_SAMPLE)), 1)
    neg_lf = (
        lf.filter(pl.col("label_fail_within_30d") == 0)
        .with_row_index(name="_row_idx")
        .filter((pl.col("_row_idx") % stride) == 0)
        .drop("_row_idx")
    )

    print(f"[collect] streaming positives + {NEG_SAMPLE*100:.1f}% of negatives", flush=True)
    pos_df = pos_lf.collect(streaming=True)
    neg_df = neg_lf.collect(streaming=True)
    print(f"[info] positives loaded: {pos_df.height:,}", flush=True)
    print(f"[info] negatives loaded: {neg_df.height:,}", flush=True)

    df = pl.concat([pos_df, neg_df], how="diagonal_relaxed")
    del pos_df, neg_df

    # Attach AFR prior and model_id
    df = df.with_columns([
        pl.col("model").map_elements(lambda m: afr_map.get(m, DEFAULT_AFR), return_dtype=pl.Float32).alias("model_afr_prior"),
        pl.col("model").map_elements(lambda m: model_id_map.get(m, 0), return_dtype=pl.Int32).alias("model_id"),
    ])
    # Fill NA deltas with 0
    df = df.with_columns([pl.col(c).fill_null(0) for c in feature_cols if c in df.columns])

    df_pd = df.to_pandas()
    print(f"[info] combined frame: {len(df_pd):,} rows  memory≈{df_pd.memory_usage(deep=True).sum() / 1e9:.2f} GB", flush=True)

    import pandas as pd
    df_pd["date"] = pd.to_datetime(df_pd["date"])
    split = pd.Timestamp(SPLIT_DATE_STR)
    train_df = df_pd[df_pd["date"] < split]
    val_df = df_pd[df_pd["date"] >= split]
    print(f"[split] train={len(train_df):,}  val={len(val_df):,}", flush=True)

    y_train = train_df["label_fail_within_30d"].astype("int8").to_numpy()
    y_val = val_df["label_fail_within_30d"].astype("int8").to_numpy()
    pos = int((y_train == 1).sum())
    neg = int((y_train == 0).sum())
    # Re-weight so that scale_pos_weight matches the ORIGINAL population
    # positive rate, not the sampled one. Otherwise we'd be severely
    # under-weighting positives given the negative downsampling.
    scale_pos_weight = max(neg / max(pos, 1) / NEG_SAMPLE, 1.0)
    print(f"[info] positives={pos:,}  negatives={neg:,} (sampled)  scale_pos_weight={scale_pos_weight:.2f}", flush=True)

    X_train = train_df[feature_cols].astype("float32")
    X_val = val_df[feature_cols].astype("float32")

    params = dict(
        objective="binary",
        metric="auc",
        boosting_type="gbdt",
        num_leaves=63,
        learning_rate=0.05,
        feature_fraction=0.8,
        bagging_fraction=0.8,
        bagging_freq=5,
        scale_pos_weight=scale_pos_weight,
        verbose=-1,
    )

    train_data = lgb.Dataset(X_train, label=y_train)
    val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

    model = lgb.train(
        params, train_data,
        num_boost_round=1000,
        valid_sets=[val_data],
        callbacks=[lgb.early_stopping(stopping_rounds=50), lgb.log_evaluation(100)],
    )

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))
    FEATURE_ORDER_PATH.write_text(json.dumps(feature_cols, indent=2))
    print(f"[save] {MODEL_PATH}  features={FEATURE_ORDER_PATH}", flush=True)


if __name__ == "__main__":
    main()
