# train-drive-model

Offline training pipeline for the Dashboard drive-failure tree ranker
(v1.1 of the trend warnings system).

**Runs on `the GPU host`** (AMD EPYC 4464P, 12 Zen 4 cores). Training
finishes in 5-15 minutes; the bottleneck is downloading ~20-40 GB of
Backblaze quarterly data.

## Pipeline

```
download_backblaze.py  -> $BACKBLAZE_DATA_DIR/data_Q*_YYYY/*.csv
prepare_features.py    -> ./data/features.parquet
build_afr_table.py     -> apps/dashboard/models/drive-model-afr-v1.json
train.py               -> ./data/lightgbm-raw.txt
validate.py            -> apps/dashboard/models/drive-failure-lightgbm-v1.metadata.json
export_onnx.py         -> apps/dashboard/models/drive-failure-lightgbm-v1.onnx
```

## Quickstart

```bash
cd tools/train-drive-model
bash run_all.sh
```

This creates a venv, installs `requirements.txt`, and runs all stages.

Raw Backblaze data persists between runs in `$BACKBLAZE_DATA_DIR` (default
`/home/agent/backblaze-data/`). Only the `.onnx`, metadata JSON, and AFR
table get committed to the repo; `data/`, `venv/`, and any CSV/zip
extracts are gitignored.

## Validation thresholds

`validate.py` hard-fails (exit 1) if:

- AUROC < 0.85
- Precision at 0.8% FPR < 0.65

Target bar (from the spec): AUROC > 0.90, P@0.8%FPR > 0.75.

## Quarterly refresh

1. Edit `QUARTERS` in `download_backblaze.py` (drop oldest, add newest).
2. Run `bash run_all.sh`.
3. If AUROC drops >2% vs prior version, investigate before committing.
4. Commit `apps/dashboard/models/*.onnx`, metadata JSON, and AFR JSON; open a PR.
