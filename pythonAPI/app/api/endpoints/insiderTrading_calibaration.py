
# insiderTrading_calibaration.py
# ---------------------------------------------------------------------------
# FastAPI router for Insider Trading calibration / refinement.
# - Guarantees non-zero *_score columns via proxy scoring when source data lacks them
# - Supports three thresholding modes: fixed, quantile, and target_count
# - Can aim for ~5–20 True Positives regardless of absolute score scale
#
# Drop-in: place under your app/api/endpoints (or wherever you keep routers),
# and include this router in main.py with:
#   from api.endpoints.insiderTrading_calibaration import router as insider_router
#   app.include_router(insider_router)
# ---------------------------------------------------------------------------
from __future__ import annotations

import os
import re
from typing import Optional, Literal, Tuple, Dict, List

import numpy as np
import pandas as pd
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

# -----------------------------
# Configuration
# -----------------------------
# Replace absolute defaults with project-relative paths (original lines) :contentReference[oaicite:20]{index=20}
# --- dual import so it works from project root OR /app ---
try:
    from app.core.paths import SIMULATED_DIR, RESULTS_DIR
except ModuleNotFoundError:
    from core.paths import SIMULATED_DIR, RESULTS_DIR
SIMULATED_DIR_DEFAULT = str(SIMULATED_DIR)
RESULTS_DIR_DEFAULT   = str(RESULTS_DIR)

router = APIRouter(prefix="/insidertrading", tags=["Insider Trading – Calibration"])  # :contentReference[oaicite:21]{index=21}

# Expected score columns and possible *_ok boolean sources
EXPECTED_SCORE_COLS = [
    "pattern_score",
    "micro_score",
    "concentration_score",
    "context_score",
    "crossvenue_score",
]

OK_BOOL_COLS = [
    "pattern_ok",
    "micro_ok",
    "concentration_ok",
    "context_ok",
    "crossvenue_ok",
]

NUMERIC_EXCLUDE = {
    "id","alert_id","symbol","ticker","isin","ric","sedol",
    "report_short_name","classification"
}

# -----------------------------
# Pydantic Models
# -----------------------------
class Weights(BaseModel):
    pattern: float = 0.30
    micro: float = 0.20
    concentration: float = 0.20
    context: float = 0.15
    crossvenue: float = 0.15

    def normalized(self) -> "Weights":
        s = self.pattern + self.micro + self.concentration + self.context + self.crossvenue
        if s <= 0:
            # default equal if user sends all zeros
            return Weights(pattern=0.2, micro=0.2, concentration=0.2, context=0.2, crossvenue=0.2)
        return Weights(
            pattern=self.pattern/s,
            micro=self.micro/s,
            concentration=self.concentration/s,
            context=self.context/s,
            crossvenue=self.crossvenue/s,
        )

class Params(BaseModel):
    # Optional file-level filter
    report_short_name: Optional[str] = Field(None, description="Filter by report type if present in file")

    # Thresholding
    true_positive_threshold: float = Field(0.85, ge=0.0, le=1.0)
    threshold_mode: Literal["fixed","quantile","target_count"] = "fixed"
    top_pct: float = Field(5.0, ge=0.1, le=100.0, description="When threshold_mode='quantile', keep top N percent")

    # Target TP range
    target_tp_min: Optional[int] = Field(None, ge=1)
    target_tp_max: Optional[int] = Field(None, ge=1)

    # If your file lacks scores/booleans, allow synthesizing from numerics
    force_proxy_scoring: bool = False

class RefineRequest(BaseModel):
    out_dir: str = Field(SIMULATED_DIR_DEFAULT, description="Directory containing latest simulated alerts (CSV or Parquet)")
    limit: Optional[int] = Field(None, ge=1, description="Cut row count to this many (after load & filtering)")
    return_mode: Literal["all","tp_only"] = "all"
    params: Params = Field(default_factory=Params)
    weights: Weights = Field(default_factory=Weights)

class Extras(BaseModel):
    tp_count: int
    tn_count: int
    used_threshold: float
    p90: float
    p95: float
    p99: float
    total: int

class RefineResponse(BaseModel):
    message: str
    count: int
    true_positive_threshold: float
    results: List[Dict]
    extras: Extras

# -----------------------------
# File IO
# -----------------------------
def _list_candidate_files(base_dir: str) -> list[str]:
    try:
        all_files = [os.path.join(base_dir, f) for f in os.listdir(base_dir)]
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Directory not found: {base_dir}")
    files = [f for f in all_files if f.lower().endswith((".csv",".parquet"))]
    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return files

def _load_latest_dataframe(out_dir: str, report_short_name: Optional[str]) -> pd.DataFrame:
    files = _list_candidate_files(out_dir)
    if not files:
        raise HTTPException(status_code=404, detail=f"No CSV/Parquet files found in: {out_dir}")

    # Prefer a file whose name contains `report_short_name`
    best = None
    if report_short_name:
        key = report_short_name.lower()
        for f in files:
            if key in os.path.basename(f).lower():
                best = f
                break
    if best is None:
        best = files[0]

    try:
        if best.lower().endswith(".csv"):
            df = pd.read_csv(best)
        else:
            df = pd.read_parquet(best)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file {best}: {e}")

    # Optional in-file filter
    if report_short_name and "report_short_name" in df.columns:
        df = df[df["report_short_name"].astype(str).str.lower() == report_short_name.lower()]

    if df.empty:
        raise HTTPException(status_code=404, detail="Loaded file has no rows after filtering.")

    return df

# -----------------------------
# Scoring helpers
# -----------------------------
def _pct_rank(series: pd.Series) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce")
    if s.notna().sum() <= 1:
        return pd.Series(np.zeros(len(s)), index=series.index)
    return s.rank(pct=True).fillna(0.0).clip(0.0, 1.0)

def _pick_pct(df: pd.DataFrame, patterns: list[str]) -> pd.Series:
    cols = [c for c in df.columns if c.lower() not in NUMERIC_EXCLUDE]
    for p in patterns:
        rgx = re.compile(p, flags=re.IGNORECASE)
        cand = [c for c in cols if rgx.search(c)]
        for c in cand:
            if pd.api.types.is_numeric_dtype(df[c]):
                use = df[c].abs() if ("return" in c.lower() or "change" in c.lower()) else df[c]
                return _pct_rank(use)
    return pd.Series(np.zeros(len(df)), index=df.index)

def _proxy_scoring(df: pd.DataFrame) -> pd.DataFrame:
    # 1) *_ok → [0,1]
    for b in OK_BOOL_COLS:
        if b in df.columns:
            df[b] = pd.to_numeric(df[b], errors="coerce").fillna(0.0).clip(0, 1)

    # 2) initialize scores from booleans if present, else zeros (filled later)
    mapping = {
        "pattern_score":      ("pattern_ok",),
        "micro_score":        ("micro_ok",),
        "concentration_score":("concentration_ok",),
        "context_score":      ("context_ok",),
        "crossvenue_score":   ("crossvenue_ok",),
    }
    for score_col, ok_candidates in mapping.items():
        if score_col not in df.columns:
            for okc in ok_candidates:
                if okc in df.columns:
                    df[score_col] = df[okc]
                    break
            if score_col not in df.columns:
                df[score_col] = 0.0

    # 3) synthesize zeros from numeric signals by keyword
    if (df["pattern_score"] == 0).all():
        df["pattern_score"] = _pick_pct(df, [
            r"(return|price[_]*change|pump_vs_dump_increase_pct|swing|vol(atility)?)",
            r"(peak|spike|jump)"
        ])
    if (df["micro_score"] == 0).all():
        df["micro_score"] = _pick_pct(df, [
            r"(order[_]*imbalance|quote[_]*change|spread|depth|cancel[_]*rate|fill[_]*rate|micro)"
        ])
    if (df["concentration_score"] == 0).all():
        df["concentration_score"] = _pick_pct(df, [
            r"(top[_]*broker[_]*share|dominance|herfindahl|hhi|concentration)"
        ])
    if (df["context_score"] == 0).all():
        df["context_score"] = _pick_pct(df, [
            r"(news|announcement|board|insider|context|pre[_]*open|post[_]*close|event)"
        ])
        if (df["context_score"] == 0).all():
            df["context_score"] = _pick_pct(df, [r"(volume|turnover|value[_]*traded|vwap)"])
    if (df["crossvenue_score"] == 0).all():
        df["crossvenue_score"] = _pick_pct(df, [
            r"(venue|exchange|market|ats|darkpool|cross[_]*venue|venue[_]*count|unique[_]*venue)"
        ])

    for c in EXPECTED_SCORE_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0).clip(0.0, 1.0)
    return df

def _ensure_scores(df: pd.DataFrame, force_proxy: bool) -> pd.DataFrame:
    # If all expected scores exist and not all-zero, keep; else synthesize
    missing = [c for c in EXPECTED_SCORE_COLS if c not in df.columns]
    all_zero = all((c in df.columns and (df[c] == 0).all()) for c in EXPECTED_SCORE_COLS)
    if force_proxy or missing or all_zero:
        df = _proxy_scoring(df)
    # Ensure rubric_score column exists
    if "rubric_score" not in df.columns:
        df["rubric_score"] = 0.0
    return df

def _compute_rubric_score(df: pd.DataFrame, w: Weights) -> pd.DataFrame:
    df["rubric_score"] = (
        df["pattern_score"] * w.pattern
        + df["micro_score"] * w.micro
        + df["concentration_score"] * w.concentration
        + df["context_score"] * w.context
        + df["crossvenue_score"] * w.crossvenue
    ).clip(0.0, 1.0)
    return df

# -----------------------------
# Classification helpers
# -----------------------------
def _classify_fixed(df: pd.DataFrame, thr: float) -> pd.DataFrame:
    df["classification"] = (df["rubric_score"] >= thr).map({True: "True Positive", False: "True Negative"})
    return df

def _classify_quantile(df: pd.DataFrame, top_pct: float) -> Tuple[pd.DataFrame, float]:
    n = len(df)
    if n == 0:
        return df.assign(classification="True Negative"), 1.0
    keep = max(1, int(round((top_pct/100.0) * n)))
    q = 1.0 - (keep / float(n))
    thr = float(df["rubric_score"].quantile(q))
    df["classification"] = (df["rubric_score"] >= thr).map({True: "True Positive", False: "True Negative"})
    return df, thr

def _classify_by_target_count(df: pd.DataFrame, min_tp: int, max_tp: int) -> Tuple[pd.DataFrame, float]:
    n = len(df)
    if n == 0:
        return df.assign(classification="True Negative"), 1.0
    lower = max(1, min_tp)
    upper = max(lower, max_tp)
    k_default = max(1, round(0.10 * n))  # ~10% as a sensible default
    k = min(upper, max(lower, k_default))
    k = min(k, n)

    q = 1.0 - (k / float(n))
    thr = float(df["rubric_score"].quantile(q))
    df["classification"] = (df["rubric_score"] >= thr).map({True: "True Positive", False: "True Negative"})
    return df, thr

def _summarize(df: pd.DataFrame, used_threshold: float) -> Extras:
    p90 = float(df["rubric_score"].quantile(0.90)) if len(df) else 0.0
    p95 = float(df["rubric_score"].quantile(0.95)) if len(df) else 0.0
    p99 = float(df["rubric_score"].quantile(0.99)) if len(df) else 0.0
    tp_count = int((df["classification"] == "True Positive").sum()) if "classification" in df.columns else 0
    tn_count = int((df["classification"] == "True Negative").sum()) if "classification" in df.columns else 0
    return Extras(
        tp_count=tp_count,
        tn_count=tn_count,
        used_threshold=float(used_threshold),
        p90=p90, p95=p95, p99=p99,
        total=int(len(df)),
    )

# -----------------------------
# API Endpoint
# -----------------------------
@router.post("/refine", response_model=RefineResponse)
def refine_insider_trading(request: RefineRequest = Body(...)):
    """
    Refine insider trading alerts by computing/ensuring *_score columns, producing a rubric_score,
    and classifying rows into True Positive / True Negative via one of three modes:
      - fixed:       rubric_score >= true_positive_threshold
      - quantile:    keep top_pct % as True Positive
      - target_count: aim for target_tp_min..target_tp_max True Positives (size-aware)
    """
    # 1) Load data
    df = _load_latest_dataframe(request.out_dir, request.params.report_short_name)

    # 2) Optional limit
    if request.limit is not None:
        df = df.head(request.limit)

    # 3) Ensure scores and compute rubric
    df = _ensure_scores(df, request.params.force_proxy_scoring)
    weights = request.weights.normalized()
    df = _compute_rubric_score(df, weights)

    # 4) Classify
    used_threshold: float = request.params.true_positive_threshold
    mode = request.params.threshold_mode
    if mode == "target_count" and request.params.target_tp_min and request.params.target_tp_max:
        df, used_threshold = _classify_by_target_count(df, request.params.target_tp_min, request.params.target_tp_max)
    elif mode == "quantile":
        df, used_threshold = _classify_quantile(df, request.params.top_pct)
    else:
        df = _classify_fixed(df, request.params.true_positive_threshold)

    # 5) Prepare response
    out_df = df.copy()
    if request.return_mode == "tp_only":
        out_df = out_df[out_df["classification"] == "True Positive"]

    # Ensure expected columns exist for downstream consumers
    for col in ["rubric_score", "classification", *EXPECTED_SCORE_COLS]:
        if col not in out_df.columns:
            out_df[col] = np.nan

    # Convert to list of dicts (records)
    results = out_df.to_dict(orient="records")
    extras = _summarize(df, used_threshold)

    return RefineResponse(
        message="Insider Trading refinement complete",
        count=len(results),
        true_positive_threshold=float(used_threshold),
        results=results,
        extras=extras
    )
