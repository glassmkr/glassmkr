#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export BACKBLAZE_DATA_DIR="${BACKBLAZE_DATA_DIR:-/home/agent/backblaze-data}"
export DATA_DIR="${DATA_DIR:-$(pwd)/data}"

if [ ! -d venv ]; then
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
pip install --quiet onnxruntime  # used only for the parity check in export_onnx.py

echo "=== [1/5] download ==="
python download_backblaze.py

echo "=== [2/5] features ==="
python prepare_features.py

echo "=== [3/5] AFR table ==="
python build_afr_table.py

echo "=== [4/5] train ==="
python train.py

echo "=== [5/5] validate + export ONNX ==="
python validate.py
python export_onnx.py

echo
echo "Training complete. Commit the following files:"
echo "  apps/dashboard/models/drive-failure-lightgbm-v1.onnx"
echo "  apps/dashboard/models/drive-failure-lightgbm-v1.metadata.json"
echo "  apps/dashboard/models/drive-model-afr-v1.json"
