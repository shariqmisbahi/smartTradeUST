# app/api/endpoints/assets_csv_engine.py
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse
from zoneinfo import ZoneInfo

# ---- Robust imports for your detector core -----------------------------------
# Tries common layouts: app.logic.pump_and_dump, logic.pump_and_dump, pump_and_dump
try:
    from app.logic import pump_and_dump as pad  # type: ignore
except Exception:
    try:
        from logic import pump_and_dump as pad  # type: ignore
    except Exception:
        import importlib

        pad = importlib.import_module("pump_and_dump")  # type: ignore

# ------------------------------------------------------------------------------
router = APIRouter(prefix="/api/assets", tags=["assets-csv"])

# ---- Helpers -----------------------------------------------------------------


def _assets_dir() -> Path:
    """
    Resolve (and ensure) the assets/ directory.

    Priority:
      1) ASSETS_DIR env var
      2) CWD/assets
      3) project-root guess based on this file
    """
    env_dir = os.getenv("ASSETS_DIR")
    if env_dir:
        p = Path(env_dir).expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    # Prefer current working dir (usually project root when running uvicorn)
    cwd_assets = Path.cwd() / "/TradeMY3/data/assets"
    try:
        cwd_assets.mkdir(parents=True, exist_ok=True)
        return cwd_assets.resolve()
    except Exception:
        pass

    # Fallback: walk up a few parents and create assets/ next to app/
    here = Path(__file__).resolve()
    for ancestor in [here.parent, *here.parents]:
        candidate = ancestor / "assets"
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate.resolve()
        except Exception:
            continue

    # Last resort: temp under CWD
    last = Path.cwd() / "assets"
    last.mkdir(parents=True, exist_ok=True)
    return last.resolve()


def _csv_path(csv_filename: str) -> Path:
    p = _assets_dir() / csv_filename
    if not p.exists():
        raise FileNotFoundError(f"CSV not found: {p}")
    return p


def _load_trades_csv(csv_filename: str) -> pd.DataFrame:
    """
    Load CSV into DataFrame; coerce timestamp to UTC; normalize `symbol` -> `ticker`.
    """
    df = pd.read_csv(_csv_path(csv_filename))
    if "symbol" in df.columns and "ticker" not in df.columns:
        df = df.rename(columns={"symbol": "ticker"})
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df = df.dropna(subset=["timestamp"])
    return df


def _now_ts_str() -> str:
    # Use your local timezone for filenames / labels
    return datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).strftime("%Y%m%d_%H%M%S")


def _json_sanitize(obj: Any) -> Any:
    """
    Recursively convert NaN/±inf -> None, numpy scalars -> py types,
    datetimes -> ISO 'Z', dataclasses -> dict.
    """
    # dataclass first
    if is_dataclass(obj):
        return _json_sanitize(asdict(obj))

    # pandas NA
    try:
        if obj is pd.NA:  # type: ignore[attr-defined]
            return None
    except Exception:
        pass

    # scalars
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat().replace("+00:00", "Z")

    # containers
    if isinstance(obj, dict):
        return {k: _json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_json_sanitize(v) for v in obj]

    return obj


def _df_to_records_jsonsafe(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Make a DataFrame JSON-safe: ±inf -> NaN -> None; timestamps -> ISO; to list[dict]."""
    if df.empty:
        return []
    # replace infs with NaN first
    df = df.replace([np.inf, -np.inf], np.nan)
    # set object dtype so None survives JSON
    df = df.astype(object).where(pd.notnull(df), None)

    # normalize datetime columns (ensure UTC, ISO on output)
    for col in df.columns:
        # If it's datetime-like, coerce then keep as datetime64[ns, UTC] for later stringifying
        try:
            if np.issubdtype(getattr(df[col], "dtype", object), np.datetime64):
                df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
        except Exception:
            # best-effort
            pass

    records = df.to_dict(orient="records")
    return _json_sanitize(records)  # one more recursive pass, just in case


def _json_ok(payload: Any) -> JSONResponse:
    """Always return a JSONResponse with sanitized content."""
    return JSONResponse(content=_json_sanitize(payload))


def _save_json(payload: Any, filename: str) -> str:
    """Strict JSON writer (no NaN/inf)."""
    out = _assets_dir() / filename
    with out.open("w", encoding="utf-8") as f:
        json.dump(_json_sanitize(payload), f, ensure_ascii=False, indent=2, allow_nan=False, default=str)
    return str(out)


# ---- Models ------------------------------------------------------------------


class TimeWindow(BaseModel):
    start: datetime = Field(..., description="Start datetime (ISO-8601).")
    end: datetime = Field(..., description="End datetime (ISO-8601).")


class RuleParams(BaseModel):
    window_minutes: int
    dump_window_minutes: int
    pump_pct: float
    dump_pct: float
    vol_window: int
    vol_mult: float
    min_bars: int
    resample_rule: str


class RuleWeights(BaseModel):
    pump_strength: float
    dump_strength: float
    volume_strength: float


class ManualDetectRequest(TimeWindow):
    params: RuleParams
    weights: RuleWeights


# ---- Endpoint 1: GET combined faults (no saving) -----------------------------


@router.get("/export-faults", summary="Get combined Ramping + Pump-and-Dump rows from CSV (no saving)")
def export_faults(
    csv_filename: str = Query("trades.csv", description="CSV filename inside assets/"),
    sort_by_timestamp: bool = Query(True, description="Sort combined output by timestamp if present"),
):
    """
    Reads assets/{csv_filename}, filters fault_type in {'Ramping','Pump and Dump'},
    and returns a single combined list as JSON. No files are written.
    """
    try:
        df = _load_trades_csv(csv_filename)
        if "fault_type" not in df.columns:
            raise HTTPException(status_code=400, detail="CSV has no 'fault_type' column")

        # Normalize fault names to canonical labels
        def _norm_fault(x: Any) -> str:
            s = str(x).strip().lower()
            if s == "ramping":
                return "Ramping"
            if s in {"pump and dump", "pump_and_dump", "pump&dump", "pump-dump"}:
                return "Pump and Dump"
            return str(x)

        df["fault_type_norm"] = df["fault_type"].apply(_norm_fault)
        filt = df[df["fault_type_norm"].isin(["Ramping", "Pump and Dump"])].copy()

        # Normalize timestamp and sort
        if "timestamp" in filt.columns:
            filt["timestamp"] = pd.to_datetime(filt["timestamp"], utc=True, errors="coerce")
            filt = filt.dropna(subset=["timestamp"])
            if sort_by_timestamp:
                filt = filt.sort_values("timestamp")
            # Present as ISO strings with Z
            filt["timestamp"] = filt["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Make original 'fault_type' consistent on output
        filt["fault_type"] = filt["fault_type_norm"]
        filt = filt.drop(columns=["fault_type_norm"], errors="ignore")

        combined = _df_to_records_jsonsafe(filt)
        ramp_ct = sum(1 for r in combined if r.get("fault_type") == "Ramping")
        pnd_ct = sum(1 for r in combined if r.get("fault_type") == "Pump and Dump")

        return _json_ok(
            {
                "message": "OK",
                "csv": str(_csv_path(csv_filename)),
                "counts": {"ramping": ramp_ct, "pump_and_dump": pnd_ct, "total": len(combined)},
                "combined": combined,
            }
        )

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        # log and wrap
        # (If you have a shared logger, import and use it instead)
        print("export_faults failed:", e)
        raise HTTPException(status_code=500, detail=f"export_faults failed: {e}")


# ---- Endpoint 2: POST auto P&D detection (uses default rules) ----------------


@router.post("/detect/pump-dump/auto", summary="Auto Pump & Dump detection (rules from JSON/config)")
def detect_pnd_auto(
    payload: TimeWindow,
    csv_filename: str = Query("trades.csv", description="CSV filename inside assets/"),
    also_save: bool = Query(False, description="Also save incidents JSON in assets/"),
):
    """
    Uses pad.detect_from_trades(...) with defaults (your core should load its own config).
    Scans ALL rows within [start, end] for all tickers; returns incidents. Optionally saves
    assets/Pump_Dump_auto_{timestamp}.json when also_save=True.
    """
    try:
        df = _load_trades_csv(csv_filename)
        if df.empty:
            return _json_ok({"message": "No data", "rule_name": "pump_and_dump", "count": 0, "incidents": []})

        # Filter by time window if timestamp exists
        if "timestamp" in df.columns:
            start = pd.Timestamp(payload.start, tz="UTC")
            end = pd.Timestamp(payload.end, tz="UTC")
            df = df[(df["timestamp"] >= start) & (df["timestamp"] <= end)]

        # pad.detect_from_trades should return (incidents, debug/bars/whatever)
        if hasattr(pad, "detect_from_trades"):
            incidents, _debug = pad.detect_from_trades(df, rule_name="pump_and_dump", annotate=True)  # type: ignore
        else:
            raise RuntimeError("pad.detect_from_trades not found")

        # Convert incidents into JSON-safe dicts
        inc_json: List[Dict[str, Any]] = []
        for inc in incidents:
            rec = asdict(inc) if is_dataclass(inc) else dict(inc)
            for k in ("start_ts", "peak_ts", "end_ts"):
                v = rec.get(k)
                if isinstance(v, (pd.Timestamp, datetime)):
                    rec[k] = v.isoformat().replace("+00:00", "Z")
            inc_json.append(rec)

        inc_json = _json_sanitize(inc_json)
        result = {"message": "Auto detection completed", "rule_name": "pump_and_dump", "count": len(inc_json), "incidents": inc_json}

        if also_save:
            ts = _now_ts_str()
            result["saved"] = _save_json(inc_json, f"Pump_Dump_auto_{ts}.json")

        return _json_ok(result)

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        print("detect_pnd_auto failed:", e)
        raise HTTPException(status_code=500, detail=f"detect_pnd_auto failed: {e}")


# ---- Endpoint 3: POST manual P&D detection (params + weights from UI) --------


@router.post("/detect/pump-dump/manual", summary="Manual Pump & Dump detection (params + weights from UI)")
def detect_pnd_manual(
    req: ManualDetectRequest,
    csv_filename: str = Query("trades.csv", description="CSV filename inside assets/"),
    also_save: bool = Query(False, description="Also save incidents JSON in assets/"),
):
    """
    Applies user-provided params/weights without touching the global config:
      - Builds bars via pad._bars_from_trades
      - Runs pad.detect_from_bars with your overrides per ticker
    Optionally saves assets/Pump_Dump_manual_{timestamp}.json when also_save=True.
    """
    try:
        df = _load_trades_csv(csv_filename)
        if df.empty:
            return _json_ok(
                {"message": "No data", "rule_name": "pump_and_dump_manual", "count": 0, "incidents": []}
            )

        # Filter by time window if timestamp exists
        if "timestamp" in df.columns:
            start = pd.Timestamp(req.start, tz="UTC")
            end = pd.Timestamp(req.end, tz="UTC")
            df = df[(df["timestamp"] >= start) & (df["timestamp"] <= end)]

        # Extract params / weights in a Pydantic-v2/v1 friendly way
        params = req.params.model_dump() if hasattr(req.params, "model_dump") else req.params.dict()
        weights = req.weights.model_dump() if hasattr(req.weights, "model_dump") else req.weights.dict()

        # Build bars per ticker using chosen resample rule
        if hasattr(pad, "_bars_from_trades"):
            bars_map = pad._bars_from_trades(df, params.get("resample_rule", "1min"))  # type: ignore
        else:
            raise RuntimeError("pad._bars_from_trades not found")

        incidents_out: List[Dict[str, Any]] = []
        # For each ticker, run detector with overrides
        if not hasattr(pad, "detect_from_bars"):
            raise RuntimeError("pad.detect_from_bars not found")

        for tkr, bars in bars_map.items():
            incs = pad.detect_from_bars(bars, params, weights)  # type: ignore
            for inc in incs:
                rec = asdict(inc) if is_dataclass(inc) else dict(inc)
                rec["ticker"] = rec.get("ticker") or tkr
                for k in ("start_ts", "peak_ts", "end_ts"):
                    v = rec.get(k)
                    if isinstance(v, (pd.Timestamp, datetime)):
                        rec[k] = v.isoformat().replace("+00:00", "Z")
                incidents_out.append(rec)

        incidents_out = _json_sanitize(incidents_out)

        result = {
            "message": "Manual detection completed",
            "rule_name": "pump_and_dump_manual",
            "count": len(incidents_out),
            "incidents": incidents_out,
        }

        if also_save:
            ts = _now_ts_str()
            result["saved"] = _save_json(incidents_out, f"Pump_Dump_manual_{ts}.json")

        return _json_ok(result)

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        print("detect_pnd_manual failed:", e)
        raise HTTPException(status_code=500, detail=f"detect_pnd_manual failed: {e}")
