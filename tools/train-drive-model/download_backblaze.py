"""Download and extract Backblaze quarterly drive-failure data.

Reads destination from BACKBLAZE_DATA_DIR env var (default
/home/agent/backblaze-data/). Skips quarters already extracted on disk.
"""
import os
import sys
import requests
import zipfile
from pathlib import Path

QUARTERS = [
    "data_Q1_2024", "data_Q2_2024", "data_Q3_2024", "data_Q4_2024",
    "data_Q1_2025", "data_Q2_2025", "data_Q3_2025", "data_Q4_2025",
]
BASE_URL = "https://f001.backblazeb2.com/file/Backblaze-Hard-Drive-Data"
OUT_DIR = Path(os.environ.get("BACKBLAZE_DATA_DIR", "/home/agent/backblaze-data"))


def download_one(quarter: str) -> None:
    target_dir = OUT_DIR / quarter
    if target_dir.exists() and any(target_dir.rglob("*.csv")):
        print(f"[skip] {quarter} (already extracted)")
        return

    zip_path = OUT_DIR / f"{quarter}.zip"
    if not zip_path.exists():
        url = f"{BASE_URL}/{quarter}.zip"
        print(f"[download] {url}")
        with requests.get(url, stream=True, timeout=600) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            got = 0
            with open(zip_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
                    got += len(chunk)
                    if total:
                        pct = 100 * got / total
                        sys.stdout.write(f"\r  {got / 1e6:.1f} / {total / 1e6:.1f} MB ({pct:.1f}%)")
                        sys.stdout.flush()
            sys.stdout.write("\n")

    print(f"[extract] {quarter}")
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(target_dir)
    zip_path.unlink()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[info] BACKBLAZE_DATA_DIR={OUT_DIR}")
    for q in QUARTERS:
        download_one(q)
    print("[done] all quarters present")


if __name__ == "__main__":
    main()
