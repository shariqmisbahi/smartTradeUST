# pumpdump_calibaration.py  (spelling as requested)
from __future__ import annotations

import json
import os
from datetime import date, datetime, time, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Tuple  # make sure at top of file
# -------------------------------------------------------------------
# Configuration (server-owned)
# -------------------------------------------------------------------
# Defaults changed to relative paths (originals were absolute) :contentReference[oaicite:18]{index=18}
try:
    from app.core.paths import SIMULATED_DIR, RESULTS_DIR
except ModuleNotFoundError:
    from core.paths import SIMULATED_DIR, RESULTS_DIR
SIMULATED_DIR_DEFAULT = str(SIMULATED_DIR)
RESULTS_DIR_DEFAULT   = str(RESULTS_DIR)



# (keep the rest of your file; ensure defaults use these:)
# SIMULATED_DIR_DEFAULT = str(SIMULATED_DIR)
# RESULTS_DIR_DEFAULT   = str(RESULTS_DIR)


router = APIRouter(prefix="/simulate/alerts", tags=["Pump and dump"])


# Base strictness for rubric score
TRUE_POSITIVE_THRESHOLD_DEFAULT: float = 0.80

# Strict calibration goals
STRICT_REQUIRE_VOLUME: bool = True        # volume_ok must be True (we may auto-relax once)
STRICT_TARGET_MIN: int = 5                # aim for 5–12 TPs
STRICT_TARGET_MAX: int = 20
STRICT_STEP_UP: float = 0.02              # raise threshold step when too many TPs
STRICT_STEP_DOWN: float = 0.01            # lower threshold step if too few TPs
STRICT_MIN_THRESHOLD: float = 0.75        # never go below this when trying to reach min
STRICT_MAX_THRESHOLD: float = 0.995       # practical ceiling when tightening

router = APIRouter(prefix="/simulate/alerts", tags=["Pump and dump"])

TODAY = date.today()
DEFAULT_START = (TODAY - timedelta(days=5)).isoformat()
DEFAULT_END   = TODAY.isoformat()

DEFAULT_EXAMPLE = {
    "start": DEFAULT_START,
    "end": DEFAULT_END,
    "params": {
        "window_minutes": 30,
        "dump_window_minutes": 60,
        "pump_pct": 22,
        "dump_pct": 16,
        "vol_window": 30,
        "vol_mult": 3,
        "min_bars": 15,
        "resample_rule": "1min"
    },
    "weights": {
        "pump_strength": 0.45,
        "dump_strength": 0.45,
        "volume_strength": 0.1
    }
}
# -------------------------------------------------------------------
# Request / Response models (EXACT UI payload)
# -------------------------------------------------------------------
class Params(BaseModel):
    pump_pct: float = Field(..., ge=0, description="Required pump (increase) % (proxy vs dump).")
    dump_pct: float = Field(..., ge=0, description="Required dump (drop) % from pumped price.")
    window_minutes: int = Field(..., ge=1, description="Expected alert total window (start→end).")
    dump_window_minutes: int = Field(..., ge=1, description="Max window for pump→dump legs.")
    vol_window: int = Field(..., ge=1, description="Used to compute baseline volume per symbol.")
    vol_mult: float = Field(..., ge=0, description="Pump volume must exceed (median_vol * vol_mult)")
    resample_rule: str = Field(..., description="Granularity hint; used to evaluate min_bars, e.g. '1min'.")
    min_bars: int = Field(..., ge=1, description="Minimum bars (proxy via minutes) between legs.")

class Weights(BaseModel):
    pump_strength: float = Field(..., ge=0)
    dump_strength: float = Field(..., ge=0)
    volume_strength: float = Field(..., ge=0)
    # Client may send this; server still uses TRUE_POSITIVE_THRESHOLD_DEFAULT.
    strict_threshold: float = Field(0, ge=0, description="Ignored by server; server uses its own TP threshold")

    @model_validator(mode="after")
    def _normalize(self) -> "Weights":
        """Normalize weights to sum to 1.0 while preserving proportions."""
        total = float(self.pump_strength + self.dump_strength + self.volume_strength)
        if total <= 0:
            self.pump_strength = 0.45
            self.dump_strength = 0.45
            self.volume_strength = 0.10
            return self
        self.pump_strength   = float(self.pump_strength)   / total
        self.dump_strength   = float(self.dump_strength)   / total
        self.volume_strength = float(self.volume_strength) / total
        return self

class CalibrateRequest(BaseModel):
    start: date = Field(..., description="YYYY-MM-DD")
    end: date = Field(..., description="YYYY-MM-DD")
    params: Params
    weights: Weights

    @model_validator(mode="after")
    def _check_dates(self) -> "CalibrateRequest":
        if self.end < self.start:
            raise ValueError("end cannot be before start")
        return self

    def window_utc(self) -> tuple[datetime, datetime]:
        # Convert to full-day [start 00:00:00, end 23:59:59] in UTC
        start_dt = datetime.combine(self.start, time(0, 0, 0, tzinfo=timezone.utc))
        end_dt   = datetime.combine(self.end,   time(23, 59, 59, tzinfo=timezone.utc))
        return start_dt, end_dt

# ---- Response shapes ----
class Explanation(BaseModel):
    criterion: str
    value: float | int | str | bool | None = None
    threshold: float | int | str | None = None
    result: bool
    weight: float | None = None
    score: float | None = None
    meaning: str | None = None

class Incident(BaseModel):
    alert_id: str | None = None
    security_name: str | None = None
    security_type: str | None = None
    brokerage: str | None = None
    pump_ts: str | None = None
    dump_ts: str | None = None
    pump_price: float | None = None
    dump_price: float | None = None
    pump_volume: float | None = None
    dump_volume: float | None = None
    symbol_median_volume: float | None = None
    window_minutes_actual: float | None = None
    pump_vs_dump_increase_pct: float | None = None
    drop_pct: float | None = None
    vol_uplift_mult: float | None = None
    pump_strength_score: float | None = None
    dump_strength_score: float | None = None
    volume_strength_score: float | None = None
    rubric_score: float
    decision: str  # "True Positive" | "True Negative"
    explanations: List[Explanation] = []

class CalibrateResponse(BaseModel):
    message: str
    count: int
    true_positive_count: int
    returned: int
    csv_path: str
    parquet_path: str
    latest_parquet: str
    folder_simulated: str
    folder_results: str
    results: List[dict]

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
def _ensure_dir(path: str) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)

def _find_latest_parquet(folder: str) -> Path:
    p = Path(folder)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")
    files = sorted(p.glob("*.parquet"), key=lambda x: x.stat().st_mtime, reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail=f"No Parquet files found in: {folder}")
    return files[0]

def _minutes_between(ts1: pd.Timestamp, ts2: pd.Timestamp) -> float:
    return float((ts2 - ts1).total_seconds() / 60.0)

def _parse_minutes_from_rule(rule: str) -> int:
    """Very simple parser for '1min', '5min', '15min' etc. Defaults to 1 on parse failure."""
    try:
        rule = rule.lower().strip()
        if rule.endswith("min"):
            return int(rule.replace("min", ""))
    except Exception:
        pass
    return 1

def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    def norm(c: str) -> str:
        c = c.strip().lower()
        for ch in ["&", "/", "-", "(", ")", "."]:
            c = c.replace(ch, " ")
        return "_".join(c.split())
    return df.rename(columns=norm)

# -------------------------------------------------------------------
# Data loaders
# -------------------------------------------------------------------
def _load_pumpdump_subset(parquet_path: Path, start: str, end: str) -> pd.DataFrame:
    """
    Efficiently read pump & dump rows from latest Parquet between date range.
    Works with both legacy (spaced) and snake_case columns.
    """
    try:
        import pyarrow as pa
        import pyarrow.dataset as ds
        dataset = ds.dataset(str(parquet_path), format="parquet")
        try:
            filt = (
                (ds.field("report_short_name") == pa.scalar("Pump and Dump")) &
                (ds.field("date") >= pa.scalar(start)) &
                (ds.field("date") <= pa.scalar(end))
            )
            table = dataset.to_table(filter=filt)
        except Exception:
            table = dataset.to_table()
        df = table.to_pandas()
    except Exception:
        df = pd.read_parquet(str(parquet_path))

    df = _normalize_columns(df)
    if "report_short_name" not in df.columns:
        return pd.DataFrame(columns=[])

    # Robust match against values like "Pump and Dump", "pump_and_dump", "pump and dump", etc.
    rsn = df["report_short_name"].astype(str).str.strip().str.lower()
    subset = df[rsn.isin({"pump and dump", "pump_and_dump"})].copy()

    if "date" in subset.columns:
        subset = subset[(subset["date"] >= start) & (subset["date"] <= end)]

    if {"date", "time"}.issubset(subset.columns):
        subset["ts"] = pd.to_datetime(subset["date"] + " " + subset["time"], errors="coerce")
    else:
        subset["ts"] = pd.to_datetime(subset.get("timestamp", pd.NaT), errors="coerce")

    for col in ("price", "total_volume", "value"):
        if col in subset.columns:
            subset[col] = pd.to_numeric(subset[col], errors="coerce")  # <-- correct call

    return subset

def _load_baseline_for_volume(parquet_path: Path, start: str, end: str) -> pd.DataFrame:
    """
    Load a light dataframe for baseline volume per symbol using ALL alerts in the date range
    (not only Pump & Dump). Works with both legacy and snake_case columns.
    """
    try:
        import pyarrow.dataset as ds
        dataset = ds.dataset(str(parquet_path), format="parquet")
        table = dataset.to_table()
        df = table.to_pandas()
    except Exception:
        df = pd.read_parquet(str(parquet_path))

    df = _normalize_columns(df)
    needed = {"security_name", "total_volume", "date"}
    if not needed.issubset(df.columns):
        return pd.DataFrame(columns=["security_name", "total_volume", "date"])

    df = df[(df["date"] >= start) & (df["date"] <= end)].copy()
    df["total_volume"] = pd.to_numeric(df["total_volume"], errors="coerce")
    df = df.dropna(subset=["security_name", "total_volume"])
    return df[["security_name", "total_volume", "date"]]

def _compute_symbol_median_volume(baseline_df: pd.DataFrame) -> Dict[str, float]:
    """Robust baseline: median total_volume by security across ALL alerts in the window."""
    if baseline_df.empty:
        return {}
    med = baseline_df.groupby("security_name")["total_volume"].median().fillna(0.0)
    return med.to_dict()

# -------------------------------------------------------------------
# Scoring & calibration
# -------------------------------------------------------------------
def _normalize_weights(pump: float, dump: float, vol: float) -> tuple[float, float, float]:
    total = float(pump + dump + vol)
    if total <= 0:
        return 0.45, 0.45, 0.10
    return pump / total, dump / total, vol / total

def _pick_pump_dump_rows(grp: pd.DataFrame, dump_window_minutes: int) -> Tuple[Optional[pd.Series], Optional[pd.Series]]:
    """
    Prefer explicit phase markers; else choose the earliest BUY as pump and the earliest SELL
    *after that* within the dump_window. This reduces false failures on within_window.
    """
    # Normalized convenience
    mc = grp.get("market_side", pd.Series(dtype=object))
    comments = grp.get("comments", pd.Series(dtype=object)).fillna("")
    ts = pd.to_datetime(grp.get("ts"))

    # Try explicit markers first
    pump_candidates = grp[(mc == "BUY") & (comments.str.contains("phase=pump"))].sort_values("ts")
    dump_candidates = grp[(mc == "SELL") & (comments.str.contains("phase=dump"))].sort_values("ts")
    if not pump_candidates.empty and not dump_candidates.empty:
        return pump_candidates.iloc[0], dump_candidates.iloc[-1]

    # Fallback: earliest BUY, then earliest SELL after pump within window
    buys = grp[mc == "BUY"].sort_values("ts")
    sells = grp[mc == "SELL"].sort_values("ts")
    if buys.empty or sells.empty:
        return None, None

    pump_row = buys.iloc[0]
    pump_time = pd.to_datetime(pump_row.get("ts"))

    sells_after = sells[pd.to_datetime(sells["ts"]) > pump_time]
    if sells_after.empty:
        return None, None

    # pick the first SELL within dump_window; else the closest SELL after pump
    time_diff = (pd.to_datetime(sells_after["ts"]) - pump_time).dt.total_seconds() / 60.0
    within = sells_after[time_diff <= dump_window_minutes]
    dump_row = within.iloc[0] if not within.empty else sells_after.iloc[0]
    return pump_row, dump_row

def _score_alert_pair(
    pump_row: pd.Series,
    dump_row: pd.Series,
    median_vol_by_symbol: Dict[str, float],
    params: Params,
    weights: Weights,
    strict_threshold: float,
) -> Tuple[dict, bool]:
    """
    Returns (record_dict, is_true_positive) based on BASE decision (not strict pass).
    """
    # Normalize weights to sum to 1.0 (keep user proportions)
    w_pump, w_dump, w_vol = _normalize_weights(
        float(weights.pump_strength), float(weights.dump_strength), float(weights.volume_strength)
    )

    # --- Inputs
    sym = pump_row.get("security_name")
    pump_price = float(pump_row.get("price") or 0.0)
    dump_price = float(dump_row.get("price") or 0.0)
    pump_vol   = float(pump_row.get("total_volume") or 0.0)
    dump_vol   = float(dump_row.get("total_volume") or 0.0)
    pump_ts    = pd.to_datetime(pump_row.get("ts"))
    dump_ts    = pd.to_datetime(dump_row.get("ts"))

    # --- Durations & bars proxy
    total_window_min = _minutes_between(pump_ts, dump_ts)
    minutes_per_bar = _parse_minutes_from_rule(params.resample_rule)
    min_required_minutes = minutes_per_bar * params.min_bars

    within_window  = bool(total_window_min <= params.dump_window_minutes)
    min_bars_ok    = bool(total_window_min >= min_required_minutes)
    phase_order_ok = bool(pump_ts < dump_ts)

    # --- Price move proxies
    drop_pct = 0.0
    if pump_price > 0:
        drop_pct = max(0.0, (pump_price - dump_price) / pump_price * 100.0)

    pump_vs_dump_increase_pct = 0.0
    if dump_price > 0:
        pump_vs_dump_increase_pct = max(0.0, (pump_price - dump_price) / dump_price * 100.0)

    pump_ok = pump_vs_dump_increase_pct >= params.pump_pct
    dump_ok = drop_pct >= params.dump_pct

    # --- Volume uplift vs symbol median (soft factor in base)
    symbol_median = float(median_vol_by_symbol.get(sym, 0.0))
    vol_uplift_mult = (pump_vol / symbol_median) if symbol_median > 0 else 0.0
    volume_ok = vol_uplift_mult >= params.vol_mult

    # --- Scores mapped to [0,1]
    pump_strength_score = min(1.0, pump_vs_dump_increase_pct / max(1e-9, params.pump_pct))
    dump_strength_score = min(1.0, drop_pct / max(1e-9, params.dump_pct))
    volume_strength_score = min(1.0, vol_uplift_mult / max(1e-9, params.vol_mult))

    rubric_score = (
        w_pump * pump_strength_score +
        w_dump * dump_strength_score +
        w_vol  * volume_strength_score
    )

    # BASE decision (non-strict): volume_ok is soft
    hard_rules_ok = (phase_order_ok and within_window and min_bars_ok and pump_ok and dump_ok)
    decision = "True Positive" if (hard_rules_ok and rubric_score >= strict_threshold) else "True Negative"

    explanations = [
        {
            "criterion": "pump_vs_dump_increase_pct",
            "value": round(pump_vs_dump_increase_pct, 3),
            "threshold": params.pump_pct,
            "result": bool(pump_ok),
            "weight": w_pump,
            "score": round(pump_strength_score, 4),
            "meaning": "Approximate pump size relative to the post-dump price (proxy for true pump)."
        },
        {
            "criterion": "drop_pct_from_pump",
            "value": round(drop_pct, 3),
            "threshold": params.dump_pct,
            "result": bool(dump_ok),
            "weight": w_dump,
            "score": round(dump_strength_score, 4),
            "meaning": "Price fall from pumped level to dump leg."
        },
        {
            "criterion": "volume_uplift_multiple",
            "value": round(vol_uplift_mult, 3),
            "threshold": params.vol_mult,
            "result": bool(volume_ok),
            "weight": w_vol,
            "score": round(volume_strength_score, 4),
            "meaning": "Pump leg volume vs symbol median volume (soft factor)."
        },
        {
            "criterion": "time_window_total_minutes",
            "value": round(total_window_min, 3),
            "threshold": params.dump_window_minutes,
            "result": bool(within_window),
            "weight": 0.0,
            "score": None,
            "meaning": "Total duration from pump to dump must be within limit."
        },
        {
            "criterion": "min_bars_proxy_minutes",
            "value": round(total_window_min, 3),
            "threshold": min_required_minutes,
            "result": bool(min_bars_ok),
            "weight": 0.0,
            "score": None,
            "meaning": "At least N bars worth of minutes between legs."
        },
        {
            "criterion": "phase_order_ok",
            "value": True if phase_order_ok else False,
            "threshold": "BUY(pump) must occur before SELL(dump)",
            "result": bool(phase_order_ok),
            "weight": 0.0,
            "score": None,
            "meaning": "Leg ordering sanity check."
        },
    ]

    record = {
        # identity & core fields
        "alert_id": pump_row.get("alert_id"),
        "security_name": sym,
        "security_type": pump_row.get("security_type"),
        "brokerage": pump_row.get("brokerage"),
        "pump_trade_id": pump_row.get("trade_id"),
        "dump_trade_id": dump_row.get("trade_id"),
        "pump_order_id": pump_row.get("order_id"),
        "dump_order_id": dump_row.get("order_id"),
        "pump_ts": pump_ts.isoformat() if pd.notna(pump_ts) else None,
        "dump_ts": dump_ts.isoformat() if pd.notna(dump_ts) else None,
        "pump_price": pump_price,
        "dump_price": dump_price,
        "pump_volume": pump_vol,
        "dump_volume": dump_vol,
        "symbol_median_volume": symbol_median,

        # derived metrics
        "window_minutes_actual": round(total_window_min, 6),
        "pump_vs_dump_increase_pct": round(pump_vs_dump_increase_pct, 6),
        "drop_pct": round(drop_pct, 6),
        "vol_uplift_mult": round(vol_uplift_mult, 6),

        # scores
        "pump_strength_score": round(pump_strength_score, 6),
        "dump_strength_score": round(dump_strength_score, 6),
        "volume_strength_score": round(volume_strength_score, 6),
        "rubric_score": round(rubric_score, 6),

        # booleans for strict gate
        "pump_ok": bool(pump_ok),
        "dump_ok": bool(dump_ok),
        "volume_ok": bool(volume_ok),
        "within_window": bool(within_window),
        "min_bars_ok": bool(min_bars_ok),
        "phase_order_ok": bool(phase_order_ok),

        # base decision (will be overridden by strict pass)
        "decision": decision,

        # explainability
        "explanations": explanations,
    }
    return record, decision == "True Positive"

def _calibrate_df(
    df_pd: pd.DataFrame,
    baseline_df: pd.DataFrame,
    params: Params,
    weights: Weights
) -> pd.DataFrame:
    """
    Groups rows by alert_id, finds BUY(pump) then SELL(dump), computes metrics/scores,
    and returns one record per alert_id.
    """
    if df_pd.empty:
        return pd.DataFrame()

    # Build per-symbol volume baselines from ALL alerts
    median_vol = _compute_symbol_median_volume(baseline_df if baseline_df is not None else df_pd)
    strict_threshold = float(TRUE_POSITIVE_THRESHOLD_DEFAULT)

    by_alert = df_pd.groupby("alert_id", sort=False)
    records: List[dict] = []

    for alert_id, grp in by_alert:
        pump_row, dump_row = _pick_pump_dump_rows(grp, params.dump_window_minutes)
        if pump_row is None or dump_row is None:
            continue

        rec, _ = _score_alert_pair(pump_row, dump_row, median_vol, params, weights, strict_threshold)
        records.append(rec)

    return pd.DataFrame.from_records(records)

# ---------- STRICT DECISION LAYER ----------
def _strict_pass_mask(df: pd.DataFrame, require_volume: bool) -> pd.Series:
    base = (
        df["within_window"].fillna(False) &
        df["min_bars_ok"].fillna(False) &
        df["phase_order_ok"].fillna(False) &
        df["pump_ok"].fillna(False) &
        df["dump_ok"].fillna(False)
    )
    if require_volume and "volume_ok" in df.columns:
        base = base & df["volume_ok"].fillna(False)
    return base

def _apply_strict_calibration(
    df: pd.DataFrame,
    base_threshold: float = TRUE_POSITIVE_THRESHOLD_DEFAULT,
    min_tp: int = STRICT_TARGET_MIN,
    max_tp: int = STRICT_TARGET_MAX,
    require_volume: bool = STRICT_REQUIRE_VOLUME,
    step_up: float = STRICT_STEP_UP,
    step_down: float = STRICT_STEP_DOWN,
    thr_min: float = STRICT_MIN_THRESHOLD,
    thr_max: float = STRICT_MAX_THRESHOLD,
) -> tuple[pd.DataFrame, float, int, str]:
    """
    Enforce strict gating (all hard rules + optional volume) and adaptively tune the rubric
    threshold so TP count ends in [min_tp, max_tp]. Returns (df, threshold_used, tp_count, strategy).
    """
    if df.empty:
        return df, base_threshold, 0, "empty"

    strategy = "strict"
    df = df.copy()

    # 1) Try with volume required
    thr = float(base_threshold)
    hard = _strict_pass_mask(df, require_volume=require_volume)
    mask = hard & (df["rubric_score"] >= thr)
    tp = int(mask.sum())
    while tp > max_tp and thr < thr_max:
        thr = min(thr_max, thr + step_up)
        mask = hard & (df["rubric_score"] >= thr)
        tp = int(mask.sum())

    # If too few, relax downwards (not below thr_min)
    while tp < min_tp and thr > thr_min:
        thr = max(thr_min, thr - step_down)
        mask = hard & (df["rubric_score"] >= thr)
        tp = int(mask.sum())

    # 2) If still too few and volume was required, auto-relax volume gate once
    if tp < min_tp and require_volume:
        strategy = "relaxed_volume"
        hard2 = _strict_pass_mask(df, require_volume=False)
        thr = max(thr, base_threshold)  # don't start lower than base
        mask = hard2 & (df["rubric_score"] >= thr)
        tp = int(mask.sum())

        # tighten if needed
        while tp > max_tp and thr < thr_max:
            thr = min(thr_max, thr + step_up)
            mask = hard2 & (df["rubric_score"] >= thr)
            tp = int(mask.sum())

        # relax if needed
        while tp < min_tp and thr > thr_min:
            thr = max(thr_min, thr - step_down)
            mask = hard2 & (df["rubric_score"] >= thr)
            tp = int(mask.sum())

        hard = hard2  # continue with this gate

    # 3) If STILL too few, pick top-K by rubric among hard-gated; if none, overall
        # 3) If STILL too few, pick top-K by rubric among hard-gated; if none, overall
    if tp < min_tp:
        strategy = "topk_fallback"
        eligible = df[hard].copy()
        if eligible.empty:
            eligible = df.copy()
        eligible = eligible.sort_values("rubric_score", ascending=False)
        keep = min(max_tp, len(eligible))   # allow up to max_tp
        keep_ids = set(eligible.head(keep).index.tolist())
        final_mask = df.index.isin(keep_ids)
        tp = int(final_mask.sum())          # recompute actual TP count
        thr = float(df.loc[final_mask, "rubric_score"].min()) if keep > 0 else thr


    else:
        # cap to top max_tp if still too many
        if tp > max_tp:
            strategy = "topk_cap"
            eligible = df[hard & (df["rubric_score"] >= thr)].copy()
            eligible = eligible.sort_values("rubric_score", ascending=False)
            keep_ids = set(eligible.head(max_tp).index.tolist())
            final_mask = df.index.isin(keep_ids)
            tp = min(tp, max_tp)
        else:
            final_mask = mask

    # Apply final decision
    df["decision"] = np.where(final_mask, "True Positive", "True Negative")
    return df, float(thr), int((df["decision"] == "True Positive").sum()), strategy

# -------------------------------------------------------------------
# Persistence
# -------------------------------------------------------------------
def _save_results(df: pd.DataFrame, results_dir: str, start: str, end: str) -> Tuple[str, str]:
    _ensure_dir(results_dir)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = f"pumpdump_calibration_{start}_{end}_{stamp}"
    csv_path = os.path.join(results_dir, f"{base}.csv")
    parquet_path = os.path.join(results_dir, f"{base}.parquet")

    # Sanitize nested columns for parquet
    df_to_save = df.copy()
    if "explanations" in df_to_save.columns:
        df_to_save["explanations"] = df_to_save["explanations"].apply(
            lambda x: x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)
        )

    for col in ("pump_ts", "dump_ts"):
        if col in df_to_save.columns:
            df_to_save[col] = df_to_save[col].astype(str)

    df_to_save.to_csv(csv_path, index=False)
    df_to_save.to_parquet(parquet_path, index=False)  # pyarrow backend

    return csv_path, parquet_path

# -------------------------------------------------------------------
# Endpoint
# -------------------------------------------------------------------
@router.post(
    "/calibrate",
    response_model=CalibrateResponse,
    summary="Calibrate Pump & Dump alerts (latest Parquet → strict decisions)"
)
def calibrate_latest_pumpdump(
    req: CalibrateRequest = Body(..., examples=DEFAULT_EXAMPLE)  # ← add example here
) -> CalibrateResponse:
    # Expand dates (also used as strings for filtering)
    start_str, end_str = str(req.start), str(req.end)

    # Locate latest parquet in simulated data folder
    latest_path = _find_latest_parquet(SIMULATED_DIR_DEFAULT)

    # Load subset & baseline
    df = _load_pumpdump_subset(latest_path, start_str, end_str)
    baseline_df = _load_baseline_for_volume(latest_path, start_str, end_str)

    # Compute BASE scores/booleans
    out_df = _calibrate_df(df, baseline_df, req.params, req.weights)

    # STRICT post-pass: enforce gate + tune threshold into 5–12 (with fallbacks)
    out_df, thr_used, tp_count, strategy = _apply_strict_calibration(
        out_df,
        base_threshold=TRUE_POSITIVE_THRESHOLD_DEFAULT,
        min_tp=STRICT_TARGET_MIN,
        max_tp=STRICT_TARGET_MAX,
        require_volume=STRICT_REQUIRE_VOLUME,
    )

    # Save artifacts (after strict decisions)
    csv_path, parquet_path = _save_results(out_df, RESULTS_DIR_DEFAULT, start_str, end_str)

    results_preview = out_df.head(200).to_dict(orient="records")

    # ---- after out_df is produced and strict decisions applied ----
    tp_mask = (out_df["decision"].astype(str).str.strip() == "True Positive")
    tp_df = out_df[tp_mask].copy()

    results_all = out_df.head(200).to_dict(orient="records")
    results_tp  = tp_df.head(200).to_dict(orient="records")

    return CalibrateResponse(
        message=(f"Calibration completed. Strategy={strategy}; strict TP threshold ≈ {thr_used:.3f}; "
                f"target={STRICT_TARGET_MIN}-{STRICT_TARGET_MAX}; require_volume={STRICT_REQUIRE_VOLUME}."),
        count=int(len(out_df)),                   # total rows
        true_positive_count=int(tp_mask.sum()),   # strict TP count (matches CSV)
        returned=len(results_tp),                 # preview size for TP list
        csv_path=csv_path,
        parquet_path=parquet_path,
        latest_parquet=str(latest_path),
        folder_simulated=os.path.abspath(SIMULATED_DIR_DEFAULT),
        folder_results=os.path.abspath(RESULTS_DIR_DEFAULT),
        # keep "results" as only TPs so the UI stays simple and consistent
        results=results_tp,
)
