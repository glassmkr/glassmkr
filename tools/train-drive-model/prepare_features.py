"""Build the training frame from Backblaze CSVs using DuckDB.

DuckDB streams the CSV scan, sort, and window functions with on-disk spill,
so peak memory stays bounded regardless of input size. Output is
$DATA_DIR/features.parquet with one row per (serial, date) and a
label_fail_within_30d column.
"""
import os
import sys
from pathlib import Path

import duckdb

BACKBLAZE_DATA_DIR = Path(os.environ.get("BACKBLAZE_DATA_DIR", "/home/agent/backblaze-data"))
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

RAW_SMART = ["smart_5_raw", "smart_187_raw", "smart_188_raw", "smart_189_raw", "smart_197_raw", "smart_198_raw"]

MEMORY_LIMIT = os.environ.get("DUCKDB_MEMORY_LIMIT", "24GB")
THREADS = int(os.environ.get("DUCKDB_THREADS", "8"))
TEMP_DIR = DATA_DIR / "duckdb_tmp"


def build_read_csv_columns_clause() -> str:
    """DuckDB COLUMNS hint pins the schema and skips inference across 731
    files, which is huge for read_csv_auto performance and memory."""
    cols = {
        "date": "DATE",
        "serial_number": "VARCHAR",
        "model": "VARCHAR",
        "capacity_bytes": "BIGINT",
        "failure": "TINYINT",
    }
    for c in RAW_SMART:
        cols[c] = "FLOAT"
    return "{" + ", ".join(f"'{k}': '{v}'" for k, v in cols.items()) + "}"


def main() -> None:
    print(f"[info] BACKBLAZE_DATA_DIR={BACKBLAZE_DATA_DIR}", flush=True)
    print(f"[info] DATA_DIR={DATA_DIR}", flush=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(database=":memory:")
    con.execute(f"PRAGMA memory_limit='{MEMORY_LIMIT}';")
    con.execute(f"PRAGMA threads={THREADS};")
    con.execute(f"PRAGMA temp_directory='{TEMP_DIR}';")
    # Default to preserving insertion order, but we'll sort explicitly.
    con.execute("PRAGMA preserve_insertion_order=false;")

    # Collect CSV paths via Python to skip __MACOSX junk the zip extractor
    # leaves behind. Pass the list explicitly to DuckDB.
    paths: list[str] = []
    for p in BACKBLAZE_DATA_DIR.rglob("*.csv"):
        if "__MACOSX" in p.parts or p.name.startswith("._"):
            continue
        paths.append(str(p))
    paths.sort()
    if not paths:
        raise SystemExit(f"No CSVs under {BACKBLAZE_DATA_DIR}")
    print(f"[info] {len(paths)} CSV files", flush=True)
    paths_sql = "[" + ", ".join(f"'{p}'" for p in paths) + "]"
    daily_delta_sql = ",\n            ".join(
        f"({col} - LAG({col}, 1) OVER w) AS {col.replace('_raw', '_daily_delta')}"
        for col in RAW_SMART
    )
    delta_cols_sql = []
    for col in RAW_SMART:
        name = col.replace("_raw", "")
        # Deltas reference the row N rows back within the same serial,
        # ordered by date (window w). Burst-max uses the pre-computed daily
        # delta column and a rolling MAX over the 7-row tail (window w7).
        # Nested windows (MAX(... OVER w) OVER w7) are not allowed in
        # DuckDB, so the daily-delta is materialised in a lower CTE first.
        delta_cols_sql += [
            f"({col} - LAG({col}, 1) OVER w)::REAL AS {name}_delta_1d",
            f"({col} - LAG({col}, 7) OVER w)::REAL AS {name}_delta_7d",
            f"({col} - LAG({col}, 30) OVER w)::REAL AS {name}_delta_30d",
            f"GREATEST(0, MAX({name}_daily_delta) OVER w7)::REAL AS {name}_burst_max_7d",
        ]
    delta_sql = ",\n            ".join(delta_cols_sql)

    print("[query] building features.parquet via DuckDB streaming", flush=True)
    query = f"""
        COPY (
          WITH raw AS (
            SELECT
              date,
              serial_number,
              model,
              capacity_bytes,
              COALESCE(failure, 0)::TINYINT AS failure,
              {', '.join(f'COALESCE({c}, 0)::REAL AS {c}' for c in RAW_SMART)}
            FROM read_csv(
              {paths_sql},
              header=true,
              ignore_errors=true,
              union_by_name=true,
              types={{
                'date': 'DATE',
                'serial_number': 'VARCHAR',
                'model': 'VARCHAR',
                'capacity_bytes': 'BIGINT',
                'failure': 'TINYINT',
                {', '.join(f"'{c}': 'FLOAT'" for c in RAW_SMART)}
              }}
            )
            WHERE serial_number IS NOT NULL AND date IS NOT NULL
          ),
          fail_min AS (
            SELECT serial_number, MIN(date) AS first_fail
            FROM raw WHERE failure = 1
            GROUP BY serial_number
          ),
          first_seen AS (
            SELECT serial_number, MIN(date) AS first_seen
            FROM raw GROUP BY serial_number
          ),
          joined AS (
            SELECT
              r.*,
              fm.first_fail,
              fs.first_seen,
              (date_diff('day', r.date, fm.first_fail) BETWEEN 0 AND 30)::TINYINT AS label_fail_within_30d,
              date_diff('day', fs.first_seen, r.date)::INTEGER AS drive_age_days
            FROM raw r
            LEFT JOIN fail_min fm USING (serial_number)
            LEFT JOIN first_seen fs USING (serial_number)
          ),
          with_daily AS (
            SELECT
              *,
              {daily_delta_sql}
            FROM joined
            WINDOW w AS (PARTITION BY serial_number ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
          )
          SELECT
            date, serial_number, model, capacity_bytes, failure,
            COALESCE(label_fail_within_30d, 0)::TINYINT AS label_fail_within_30d,
            drive_age_days,
            {', '.join(RAW_SMART)},
            {delta_sql}
          FROM with_daily
          WINDOW
            w   AS (PARTITION BY serial_number ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
            w7  AS (PARTITION BY serial_number ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
          ORDER BY serial_number, date
        )
        TO '{DATA_DIR / "features.parquet"}'
        (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 200000);
    """
    con.execute(query)

    stats = con.execute(
        f"SELECT COUNT(*), COALESCE(SUM(label_fail_within_30d), 0), COUNT(DISTINCT serial_number) "
        f"FROM read_parquet('{DATA_DIR / 'features.parquet'}')"
    ).fetchone()
    total = int(stats[0] or 0)
    pos = int(stats[1] or 0)
    drives = int(stats[2] or 0)
    print(f"[done] rows={total:,}  drives={drives:,}  positives={pos:,} "
          f"({100 * pos / max(total, 1):.4f}%)", flush=True)


if __name__ == "__main__":
    main()
