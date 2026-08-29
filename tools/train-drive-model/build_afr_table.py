"""Compute per-drive-model annualized failure rates (AFR) from the
prepared features frame and write drive-model-afr-v1.json.

AFR = failures / drive-days * 365, limited to models with >= 1000
drive-days for statistical significance.
"""
import json
import os
from pathlib import Path

import pandas as pd

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "apps" / "forge" / "models" / "drive-model-afr-v1.json"
MIN_DRIVE_DAYS = 1000


def main() -> None:
    feats_path = DATA_DIR / "features.parquet"
    if not feats_path.exists():
        raise SystemExit(f"{feats_path} not found; run prepare_features.py first")

    print(f"[load] {feats_path}")
    df = pd.read_parquet(feats_path, columns=["model", "failure"])

    grp = (
        df.groupby("model")
        .agg(failures=("failure", "sum"), drive_days=("failure", "count"))
    )
    grp["afr"] = grp["failures"] / grp["drive_days"] * 365.0
    filtered = grp[grp["drive_days"] >= MIN_DRIVE_DAYS]
    print(f"[info] kept {len(filtered)} models with >= {MIN_DRIVE_DAYS} drive-days "
          f"(dropped {len(grp) - len(filtered)})")

    afr_map = {str(k): float(round(v, 6)) for k, v in filtered["afr"].items()}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(afr_map, indent=2, sort_keys=True) + "\n")
    print(f"[save] {OUT_PATH} ({len(afr_map)} entries)")


if __name__ == "__main__":
    main()
