# app/api/endpoints/read_latest_pumpdump_insider_data.py

from __future__ import annotations
import os
from pathlib import Path
from typing import List, Optional
from datetime import date as _date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/simulate", tags=["Get – Read (Parquet)"])

# --- NEW: robust default dir resolution (env > project-root/data/simulated > cwd/data/simulated)
def _resolve_default_dir() -> Path:
    # 1) explicit env override (accept absolute or relative)
    env_dir = os.getenv("SIM_DATA_DIR")
    if env_dir:
        p = Path(env_dir)
        return p if p.is_absolute() else (Path.cwd() / p)

    # 2) derive project root from this file's location:
    # this file: <root>/app/api/endpoints/read_latest_pumpdump_insider_data.py
    here = Path(__file__).resolve()
    candidates = [
        # <root>/data/simulated  (siblings: app/ and data/)
        here.parents[3] / "data" / "simulated",
        # <root>/app/data/simulated (if someone actually put it under app/)
        here.parents[2] / "data" / "simulated",
        # cwd/data/simulated (fallback for ad-hoc runs)
        Path.cwd() / "data" / "simulated",
    ]
    for c in candidates:
        # if the parent (…/data) exists or can be created, pick this
        try:
            c.parent.mkdir(parents=True, exist_ok=True)
            c.mkdir(parents=True, exist_ok=True)
            return c
        except Exception:
            continue
    # last resort
    return Path.cwd() / "data" / "simulated"

DEFAULT_DIR = _resolve_default_dir()



def ensure_default_dir() -> Path:
    """Ensure the simulated data directory exists."""
    try:
        DEFAULT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unable to create directory {DEFAULT_DIR}: {e}")
    return DEFAULT_DIR


class PumpDumpResponse(BaseModel):
    message: str = Field(default="OK")
    folder: str
    latest_parquet: str
    total_rows: int
    pump_and_dump_count: int
    returned: int
    results: List[dict]
    min_date: Optional[str] = None
    max_date: Optional[str] = None
    range_days: Optional[int] = None


def _find_latest_parquet(folder: Path) -> Path:
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder.resolve()}")
    files = sorted(folder.glob("*.parquet"), key=lambda x: x.stat().st_mtime, reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail=f"No Parquet files found in: {folder.resolve()}")
    return files[0]

def _compute_date_window(latest_path: Path) -> tuple[Optional[str], Optional[str], Optional[int]]:
    """Try pyarrow first, fallback to pandas."""
    try:
        import pyarrow.dataset as ds
        import pyarrow.compute as pc
        dataset = ds.dataset(str(latest_path), format="parquet")
        t = dataset.to_table(columns=["date"])
        if t.num_rows == 0:
            return None, None, None
        col = t.column("date")
        min_s, max_s = pc.min(col).as_py(), pc.max(col).as_py()
        if not (min_s and max_s):
            return None, None, None
        dmin, dmax = _date.fromisoformat(min_s), _date.fromisoformat(max_s)
        return min_s, max_s, (dmax - dmin).days + 1
    except Exception:
        try:
            import pandas as pd
            df = pd.read_parquet(str(latest_path), columns=["date"])
            if df.empty or "date" not in df:
                return None, None, None
            min_s, max_s = str(df["date"].min()), str(df["date"].max())
            dmin, dmax = _date.fromisoformat(min_s), _date.fromisoformat(max_s)
            return min_s, max_s, (dmax - dmin).days + 1
        except Exception:
            return None, None, None


def _filter_and_read(latest_path: Path, scenario_name: str, limit: int):
    """Filter Parquet for a given scenario (Pump and Dump or Insider Trading)."""
    try:
        import pyarrow as pa
        import pyarrow.dataset as ds
        import pyarrow.parquet as pq

        pf = pq.ParquetFile(str(latest_path))
        total_rows = pf.metadata.num_rows

        dataset = ds.dataset(str(latest_path), format="parquet")
        filt = ds.field("report_short_name") == pa.scalar(scenario_name, type=pa.string())
        filtered_table = dataset.to_table(filter=filt)

        scenario_count = filtered_table.num_rows
        results = (
            filtered_table.slice(0, limit).to_pandas().to_dict("records")
            if scenario_count > 0 else []
        )
        return total_rows, scenario_count, results

    except Exception as arrow_err:
        try:
            import pandas as pd
            df = pd.read_parquet(str(latest_path))
            if "report_short_name" not in df.columns:
                raise HTTPException(status_code=422, detail="Column 'report_short_name' not found.")
            total_rows = len(df)
            filtered = df[df["report_short_name"] == scenario_name]
            scenario_count = len(filtered)
            results = filtered.head(limit).to_dict(orient="records")
            return total_rows, scenario_count, results
        except Exception as pandas_err:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to read Parquet ({latest_path}): pyarrow={arrow_err!r}, pandas={pandas_err!r}"
            )


@router.get(
    "/alerts/latest/pumpdump",
    response_model=PumpDumpResponse,
    summary="Read latest Parquet and return Pump and Dump rows as JSON"
)
def read_latest_pumpdump(limit: int = Query(200, ge=1, le=10000)):
    folder = ensure_default_dir()
    latest_path = _find_latest_parquet(folder)
    md, xd, dd = _compute_date_window(latest_path)
    total_rows, scenario_count, results = _filter_and_read(latest_path, "Pump and Dump", limit)

    return PumpDumpResponse(
        folder=str(folder),
        latest_parquet=str(latest_path),
        total_rows=total_rows,
        pump_and_dump_count=scenario_count,
        returned=len(results),
        results=results,
        min_date=md,
        max_date=xd,
        range_days=dd,
    )


@router.get(
    "/alerts/latest/insidertrading",
    response_model=PumpDumpResponse,
    summary="Read latest Parquet and return Insider Trading rows as JSON"
)
def read_latest_insidertrading(limit: int = Query(200, ge=1, le=10000)):
    folder = ensure_default_dir()
    latest_path = _find_latest_parquet(folder)
    md, xd, dd = _compute_date_window(latest_path)
    total_rows, scenario_count, results = _filter_and_read(latest_path, "Insider Trading", limit)

    return PumpDumpResponse(
        folder=str(folder),
        latest_parquet=str(latest_path),
        total_rows=total_rows,
        pump_and_dump_count=scenario_count,
        returned=len(results),
        results=results,
        min_date=md,
        max_date=xd,
        range_days=dd,
    )
