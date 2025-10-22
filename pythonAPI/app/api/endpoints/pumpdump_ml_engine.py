# api/endpoints/pumpdump_ml_engine.py
from __future__ import annotations

from fastapi import APIRouter, Body
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
from pathlib import Path
from datetime import datetime
import numpy as np
import pandas as pd
from  app.core.paths import RESULTS_ML_DIR
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import roc_auc_score
import joblib
import json

router = APIRouter(prefix="/pumpdumpml", tags=["Pump and dump"])



# --- dual import so it works from project root OR from /app ---
try:
    from app.core.paths import RESULTS_ML_DIR, RESULTS_DIR
except ModuleNotFoundError:
    from core.paths import RESULTS_ML_DIR, RESULTS_DIR
# ---------------- Schemas ----------------

class AlgoOptions(BaseModel):
    use_random_forest: bool = True
    use_isolation_forest: bool = True
    use_ensemble: bool = True
    save_models: bool = False
    model_dir: Optional[str] = None

class ScoringWeights(BaseModel):
    volume_weight: float = 0.35
    time_gap_weight: float = 0.20
    price_dev_weight: float = 0.30
    impact_weight: float = 0.15

    def normalized(self) -> "ScoringWeights":
        arr = np.array(
            [self.volume_weight, self.time_gap_weight, self.price_dev_weight, self.impact_weight],
            dtype=float
        )
        s = float(arr.sum())
        if s <= 0:
            return ScoringWeights()
        arr = arr / s
        return ScoringWeights(
            volume_weight=float(arr[0]),
            time_gap_weight=float(arr[1]),
            price_dev_weight=float(arr[2]),
            impact_weight=float(arr[3]),
        )

class FeatureParams(BaseModel):
    by: Literal["security_name","symbol","security_id","brokerage","none"] = "security_name"
    volume_roll: int = 20
    price_roll: int = 20
    impact_roll: int = 50
    min_group_size: int = 10

class StrictParams(BaseModel):
    enable: bool = True
    conf_min: float = 0.85        # absolute floor
    conf_quantile: float = 0.97   # dynamic threshold = max(conf_min, quantile)
    vol_surge_min: float = 1.5
    price_dis_z_abs_min: float = 2.5
    time_gap_burst_min: float = 1.0
    impact_min: float = 0.5
    require_pattern_spike: bool = True
    iso_anom_min: float = 0.60

    # --- NEW: adaptive thresholding so a *few* rows pass ---
    adaptive_conf: bool = True
    target_pass_min: int = 5
    target_pass_max: int = 20


class DetectResponse(BaseModel):
    message: str
    model_summary: Dict[str, Any]
    saved_parquet: Optional[str] = None
    saved_csv: Optional[str] = None
    count: int
    features_built: List[str]
    scores_added: List[str]
    sample_columns: List[str]
    results: List[Dict[str, Any]]   # JSON rows returned

# ---------------- Helpers ----------------
def _ensure_metadata_cols(df_filt: pd.DataFrame, df_all: pd.DataFrame, meta_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """
    Guarantee non-empty security_name / security_type / brokerage by coalescing from:
    - columns already in df_filt (security_name, security, name, symbol, ticker, security_id)
    - fallback join to df_all (same file) by alert_id
    - optional meta_df (e.g., latest 'simulated' parquet) by alert_id
    """
    df = df_filt.copy()

    def nonempty(s: pd.Series) -> pd.Series:
        return s.astype(str).str.strip().ne("") & s.notna()

    # Ensure columns exist
    for c in ["security_name", "security_type", "brokerage"]:
        if c not in df.columns:
            df[c] = ""

    # Coalesce security_name from common alternates (vectorized)
    candidates = [c for c in ["security_name","security","name","symbol","ticker","security_id"] if c in df.columns]
    if candidates:
        base = df["security_name"].astype(str)
        mask = ~nonempty(base)
        for c in candidates:
            src = df[c].astype(str)
            base = base.mask(mask, src)
            mask = ~nonempty(base)
        df["security_name"] = base

    # Try join from df_all by alert_id if still blank
    if "alert_id" in df.columns and "alert_id" in df_all.columns:
        meta_cols = [c for c in ["alert_id","security_name","security_type","brokerage","security","name","symbol","ticker","security_id"] if c in df_all.columns]
        if len(meta_cols) > 1:
            right = df_all[meta_cols].drop_duplicates("alert_id")
            df = df.merge(right, on="alert_id", how="left", suffixes=("", "_src"))
            # fill security_name
            dest = df["security_name"].astype(str)
            mask = ~nonempty(dest)
            for c in ["security_name_src","security_src","name","symbol","ticker","security_id"]:
                if c in df.columns:
                    dest = dest.mask(mask, df[c].astype(str))
                    mask = ~nonempty(dest)
            df["security_name"] = dest
            # fill types/brokerage if empty
            for c in ["security_type","brokerage"]:
                if f"{c}_src" in df.columns:
                    vals = df[c].astype(str)
                    mask = ~nonempty(vals)
                    df[c] = vals.mask(mask, df[f"{c}_src"].astype(str))

            # clean up
            drop_cols = [c for c in df.columns if c.endswith("_src")]
            df.drop(columns=drop_cols, inplace=True, errors="ignore")

    # Optional: join from meta_df (e.g., original 'simulated' alerts) if still blank
    if meta_df is not None and "alert_id" in df.columns and "alert_id" in meta_df.columns:
        meta_cols = [c for c in ["alert_id","security_name","security_type","brokerage","security","name","symbol","ticker","security_id"] if c in meta_df.columns]
        if len(meta_cols) > 1:
            right = meta_df[meta_cols].drop_duplicates("alert_id")
            df = df.merge(right, on="alert_id", how="left", suffixes=("", "_meta"))
            # fill from meta
            def fill_from_meta(col: str, pool: list[str]):
                vals = df[col].astype(str)
                mask = vals.str.strip().eq("") | vals.isna()
                for p in pool:
                    if p in df.columns:
                        vals = vals.mask(mask, df[p].astype(str))
                        mask = vals.str.strip().eq("") | vals.isna()
                df[col] = vals

            fill_from_meta("security_name", ["security_name_meta","security_meta","name","symbol","ticker","security_id"])
            fill_from_meta("security_type", ["security_type_meta"])
            fill_from_meta("brokerage", ["brokerage_meta"])

            drop_cols = [c for c in df.columns if c.endswith("_meta")]
            df.drop(columns=drop_cols, inplace=True, errors="ignore")

    # Final clean
    for c in ["security_name","security_type","brokerage"]:
        df[c] = df[c].fillna("").astype(str)

    return df

def _ensure_metadata_cols_simple(df_filt: pd.DataFrame, df_all: pd.DataFrame, meta_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    df = df_filt.copy()

    def _nonempty(s: pd.Series) -> pd.Series:
        return s.astype(str).str.strip().ne("") & s.notna()

    # Ensure columns exist
    for c in ["security_name", "security_type", "brokerage"]:
        if c not in df.columns:
            df[c] = ""

    # 1) Coalesce within df itself
    def coalesce(df, dest, pool):
        base = df[dest].astype(str)
        mask = ~_nonempty(base)
        for p in pool:
            if p in df.columns:
                base = base.mask(mask, df[p].astype(str))
                mask = ~_nonempty(base)
        df[dest] = base

    coalesce(df, "security_name", ["security_name","security","name","symbol","ticker","security_id"])
    coalesce(df, "security_type", ["security_type","asset_type","type","security_class"])
    coalesce(df, "brokerage", ["brokerage","broker","broker_name","brokerage_name"])

    # 2) If still blank, try df_all by alert_id
    if "alert_id" in df.columns and "alert_id" in df_all.columns:
        right_cols = [c for c in ["alert_id","security_name","security_type","brokerage","security","name","symbol","ticker","security_id"] if c in df_all.columns]
        if len(right_cols) > 1:
            right = df_all[right_cols].drop_duplicates("alert_id")
            df = df.merge(right, on="alert_id", how="left", suffixes=("", "_src"))
            coalesce(df, "security_name", ["security_name_src","security_src","name","symbol","ticker","security_id"])
            coalesce(df, "security_type", ["security_type_src"])
            coalesce(df, "brokerage", ["brokerage_src"])
            df.drop(columns=[c for c in df.columns if c.endswith("_src")], inplace=True, errors="ignore")

    # 3) Optional meta parquet backfill
    if meta_df is not None and "alert_id" in df.columns and "alert_id" in meta_df.columns:
        right_cols = [c for c in ["alert_id","security_name","security_type","brokerage","security","name","symbol","ticker","security_id"] if c in meta_df.columns]
        if len(right_cols) > 1:
            right = meta_df[right_cols].drop_duplicates("alert_id")
            df = df.merge(right, on="alert_id", how="left", suffixes=("", "_meta"))
            coalesce(df, "security_name", ["security_name_meta","security_meta","name","symbol","ticker","security_id"])
            coalesce(df, "security_type", ["security_type_meta"])
            coalesce(df, "brokerage", ["brokerage_meta"])
            df.drop(columns=[c for c in df.columns if c.endswith("_meta")], inplace=True, errors="ignore")

    # Clean
    for c in ["security_name","security_type","brokerage"]:
        df[c] = df[c].fillna("").astype(str)

    return df


class BandingParams(BaseModel):
    # Use balanced terciles by default
    method: Literal["absolute", "quantile"] = "quantile"
    # Absolute mode cutoffs (kept for manual use)
    abs_high_min: float = 0.90
    abs_med_min: float = 0.75
    # Quantile cut points (0–1). Defaults give ~1/3 each band.
    q_high: float = 0.67
    q_med: float = 0.33


class DetectRequest(BaseModel):
    out_dir: Optional[str] = Field(default=str(RESULTS_DIR))  # RESULTS_ML_DIR
    save_dir: Optional[str] =  Field(default=str(RESULTS_ML_DIR))
    output_basename: Optional[str] = Field("pumpdump_ml_Enriched", description="Filename stem for outputs")
    output_format: Literal["parquet", "csv", "both"] = "parquet"

    limit: Optional[int] = None
    seed: int = 50
    algo: AlgoOptions = AlgoOptions()
    weights: ScoringWeights = ScoringWeights()
    feat: FeatureParams = FeatureParams()
    strict: StrictParams = StrictParams()
    label_column: Optional[str] = Field(
        "string", description="Optional label column for supervised RF (0/1). If missing, falls back safely."
    )
    bands: BandingParams = BandingParams()

    # NEW (safe default)
    meta_dir: Optional[str] = Field(
        None, description="Optional folder to backfill metadata by alert_id (e.g., original alerts parquet)."
    )

RESULT_COLS_PREF = [
    "alert_id","security_name", "security_type",   
    "brokerage","symbol","timestamp","price","volume",
    "feat_volume_surge","feat_price_dislocation","feat_time_gap_burst","feat_impact_est","feat_pattern_spike",
    "score_volume","score_time_gap","score_price_dev","score_impact",
    "rf_score","iso_raw_score","ensemble_score","final_ai_score",
    "risk_band",
    "explanations_json"
]

def _filter_true_positives(df: pd.DataFrame) -> pd.DataFrame:
    cand_cols = [c for c in df.columns if c.strip().lower() == "decision"]
    if not cand_cols:
        return df.iloc[0:0].copy()
    dec_col = cand_cols[0]
    dec = df[dec_col].astype(str).str.strip().str.lower()
    return df[dec.eq("true positive")].copy()

def _apply_banding(df: pd.DataFrame, bands: BandingParams) -> pd.DataFrame:
    """
    Adds a 'risk_band' column with 'High' | 'Medium' | 'Low' based on final_ai_score.
    - Defaults to quantiles at 0.33 / 0.67 for balanced terciles.
    - Falls back to rank-based terciles if quantiles collapse (e.g., nearly-constant scores).
    """
    df = df.copy()
    if df.empty or "final_ai_score" not in df.columns:
        df["risk_band"] = pd.Series([], dtype=str)
        return df

    s = df["final_ai_score"].astype(float)

    if bands.method == "absolute":
        high_min = float(bands.abs_high_min)
        med_min  = float(bands.abs_med_min)
        df["risk_band"] = s.map(lambda v: "High" if v >= high_min else ("Medium" if v >= med_min else "Low"))
        return df

    # --- quantile mode (robust) ---
    q_hi = float(s.quantile(min(max(bands.q_high, 0.0), 1.0)))
    q_md = float(s.quantile(min(max(bands.q_med,  0.0), 1.0)))

    # If quantiles collapse (e.g., q_hi == q_md or distribution is near-constant),
    # use rank-percentiles to force ~terciles.
    if not np.isfinite(q_hi) or not np.isfinite(q_md) or q_hi <= q_md or np.isclose(q_hi, q_md, rtol=0, atol=1e-9):
        # rank method='average' to reduce ties; divide by (n+1) for clean 0..1
        ranks = s.rank(method="average", pct=True)
        df["risk_band"] = np.where(
            ranks >= 2/3, "High",
            np.where(ranks >= 1/3, "Medium", "Low")
        )
        return df

    # Normal quantile cut
    df["risk_band"] = np.where(
        s >= q_hi, "High",
        np.where(s >= q_md, "Medium", "Low")
    )
    return df


def _find_latest_parquet_file(folder: Path) -> Path:
    cands = sorted(
        list(folder.glob("*.parquet")) + list(folder.glob("*.pq")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not cands:
        raise FileNotFoundError(f"No parquet files found in {folder}")
    return cands[0]

def _load_df(path: Path) -> pd.DataFrame:
    ext = path.suffix.lower()
    if ext in (".parquet", ".pq"):
        return pd.read_parquet(path)
    raise ValueError(f"Unsupported file type for this endpoint: {ext} (only parquet allowed)")

def _ensure_dt(df: pd.DataFrame) -> pd.DataFrame:
    cand_cols = [c for c in df.columns if "time" in c.lower() or "ts" in c.lower() or "timestamp" in c.lower()]
    if cand_cols:
        col = cand_cols[0]
        df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
    return df

def _group_key(df: pd.DataFrame, feat: FeatureParams) -> Optional[str]:
    if feat.by == "none":
        return None
    for c in df.columns:
        if c.lower() == feat.by.lower():
            return c
    for probe in ("security_name","symbol","security_id"):
        if probe in df.columns:
            return probe
    return None

def _first_present(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None

def _build_features(df: pd.DataFrame, feat: FeatureParams) -> pd.DataFrame:
    df = df.copy()
    df = _ensure_dt(df)

    vol_col = _first_present(df, ["volume","qty","trade_qty","total_volume"])
    price_col = _first_present(df, ["price","last_price","close","close_price"])
    ts_col = _first_present(df, [c for c in df.columns if "time" in c.lower() or "timestamp" in c.lower() or "ts" in c.lower()])

    if vol_col is None:
        df["__vol__"] = 1.0
        vol_col = "__vol__"
    if price_col is None:
        df["__px__"] = df.get("rubric_score", pd.Series(0.0, index=df.index)) + 1.0
        price_col = "__px__"

    key = _group_key(df, feat)

    def per_group(g: pd.DataFrame) -> pd.DataFrame:
        g = g.copy()
        if ts_col and ts_col in g.columns:
            g = g.sort_values(ts_col)

        vol = g[vol_col].astype(float)
        roll_v = max(3, min(len(g), feat.volume_roll))
        v_med = vol.rolling(roll_v).median()
        g["feat_volume_surge"] = (vol / (v_med.replace(0, np.nan))).fillna(0.0)

        px = g[price_col].astype(float)
        roll_p = max(5, min(len(g), feat.price_roll))
        mu = px.rolling(roll_p).mean()
        sd = px.rolling(roll_p).std(ddof=0)
        g["feat_price_dislocation"] = ((px - mu) / (sd.replace(0, np.nan))).fillna(0.0)

        if ts_col and ts_col in g.columns and g[ts_col].notna().any():
            dt = pd.to_datetime(g[ts_col], errors="coerce", utc=True)
            gaps = dt.diff().dt.total_seconds()
            fallback = float(np.nanmedian(gaps)) if np.isfinite(np.nanmedian(gaps)) else 60.0
            gaps = gaps.fillna(fallback).replace(0.0, np.nan)
            inv = 1.0 / gaps
            inv = (inv - np.nanmean(inv)) / (np.nanstd(inv) + 1e-9)
            g["feat_time_gap_burst"] = np.nan_to_num(inv, nan=0.0)
        else:
            g["feat_time_gap_burst"] = 0.0

        ret = px.pct_change().fillna(0.0)
        roll_i = max(5, min(len(g), feat.impact_roll))
        base_imp = (ret.abs() * vol).rolling(roll_i).mean().fillna(0.0)
        if float(base_imp.std(ddof=0)) > 0.0:
            base_imp = (base_imp - base_imp.mean()) / (base_imp.std(ddof=0) + 1e-9)
        g["feat_impact_est"] = base_imp

        return g

    if key and key in df.columns:
        grp = df.groupby(key, group_keys=False)
        try:
            df = grp.apply(lambda g: per_group(g), include_groups=False)
        except TypeError:  # older pandas
            df = grp.apply(lambda g: per_group(g))
    else:
        df = per_group(df)


    df["feat_pattern_spike"] = ((df["feat_volume_surge"] > 2.0) & (df["feat_price_dislocation"].abs() > 2.0)).astype(float)

    feature_cols = [
        "feat_volume_surge", "feat_price_dislocation",
        "feat_time_gap_burst", "feat_impact_est", "feat_pattern_spike"
    ]
    df[feature_cols] = df[feature_cols].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return df

def _manipulation_scoring(df: pd.DataFrame, weights: ScoringWeights) -> pd.DataFrame:
    w = weights.normalized()
    df = df.copy()
    df["score_volume"] = np.tanh(df["feat_volume_surge"] / 3.0)
    df["score_time_gap"] = np.tanh(df["feat_time_gap_burst"] / 3.0)
    df["score_price_dev"] = np.tanh(df["feat_price_dislocation"].abs() / 3.0)
    df["score_impact"] = np.tanh(df["feat_impact_est"] / 3.0)
    df["ml_confidence_score"] = (
        w.volume_weight * df["score_volume"]
        + w.time_gap_weight * df["score_time_gap"]
        + w.price_dev_weight * df["score_price_dev"]
        + w.impact_weight * df["score_impact"]
    )
    return df

def _fit_random_forest(
    df: pd.DataFrame,
    feature_cols: List[str],
    label_col: Optional[str],
    seed: int
) -> Pipeline:
    X_all = df[feature_cols].values
    supervised = (
        label_col is not None
        and label_col in df.columns
        and df[label_col].notna().any()
        and df[label_col].nunique(dropna=True) >= 2
    )

    clf = RandomForestClassifier(
        n_estimators=400, max_depth=None, min_samples_leaf=2,
        random_state=seed, class_weight="balanced_subsample", n_jobs=-1
    )
    pipe = Pipeline([("scaler", StandardScaler()), ("rf", clf)])

    if supervised:
        work = df.dropna(subset=[label_col]).copy()
        X = work[feature_cols].values
        y = work[label_col].astype(int).values
        pipe.fit(X, y)
        return pipe

    # Unsupervised proxy — ensure both classes if possible
    proxy = df.get("ml_confidence_score")
    if proxy is None:
        proxy = pd.Series(np.zeros(len(df)), index=df.index)

    # Try quantile split to guarantee class balance
    q_lo = float(np.nanquantile(proxy, 0.25))
    q_hi = float(np.nanquantile(proxy, 0.75))
    mask_lo = proxy <= q_lo
    mask_hi = proxy >= q_hi
    use_idx = mask_lo | mask_hi

    if use_idx.sum() >= 10 and mask_lo.sum() > 0 and mask_hi.sum() > 0:
        X = df.loc[use_idx, feature_cols].values
        y = (proxy.loc[use_idx] >= q_hi).astype(int).values
        pipe.fit(X, y)
    else:
        # Fallback to median split with tiny jitter to avoid single-class
        med = float(np.nanmedian(proxy))
        jitter = np.random.default_rng(seed).normal(0, 1e-6, size=len(proxy))
        y_pseudo = ((proxy + jitter) > med).astype(int).values
        pipe.fit(X_all, y_pseudo)

    return pipe

def _fit_isolation_forest(df: pd.DataFrame, feature_cols: List[str], seed: int) -> Pipeline:
    X = df[feature_cols].values
    iso = IsolationForest(
        n_estimators=400, contamination="auto", random_state=seed, n_jobs=-1, bootstrap=True
    )
    pipe = Pipeline([("scaler", StandardScaler()), ("iso", iso)])
    pipe.fit(X)
    return pipe

def _ensemble_score(rf_prob: Optional[np.ndarray], iso_score: Optional[np.ndarray]) -> np.ndarray:
    iso_norm = None
    if iso_score is not None:
        ptp = float(np.ptp(iso_score))
        if ptp < 1e-9:
            iso_norm = np.full_like(iso_score, 0.5, dtype=float)  # neutral signal
        else:
            iso_norm = 1.0 - (iso_score - np.min(iso_score)) / (ptp + 1e-9)

    if rf_prob is None and iso_norm is None:
        return np.zeros(0)
    if rf_prob is None:
        return iso_norm
    if iso_norm is None:
        return rf_prob
    return 0.65 * rf_prob + 0.35 * iso_norm
def _apply_strict_filter(df: pd.DataFrame, strict: StrictParams):
    """
    Returns (df_selected, conf_cut, iso_norm_series)
    Guarantees non-empty selection when possible by staged relaxation:
      1) Apply all non-confidence rules
      2) Adaptive confidence cut to hit ~5–20 rows
      3) If zero, relax thresholds 25%
      4) If still zero, drop pattern_spike requirement
      5) If still zero, take top-K by final_ai_score from the whole DF
    """
    import numpy as np
    import pandas as pd

    if df is None or df.empty or not strict.enable:
        return df.copy(), None, None

    # --- Safe column accessors ---
    def col(name: str, default: float = 0.0) -> pd.Series:
        s = df[name] if name in df.columns else pd.Series(default, index=df.index, dtype=float)
        return pd.to_numeric(s, errors="coerce").fillna(default)

    vol    = col("feat_volume_surge")
    priceZ = col("feat_price_dislocation").abs()
    gap    = col("feat_time_gap_burst")
    impact = col("feat_impact_est")
    pattern= col("feat_pattern_spike", 0.0)
    conf   = col("final_ai_score")

    # --- ISO normalization (if present) ---
    iso_norm_series = None
    if "iso_raw_score" in df.columns:
        iso_raw = pd.to_numeric(df["iso_raw_score"], errors="coerce")
        mn, mx = np.nanmin(iso_raw.values), np.nanmax(iso_raw.values)
        rng = (mx - mn) if (mx - mn) and np.isfinite(mx - mn) else 1.0
        iso_norm_series = 1.0 - (iso_raw - mn) / rng
        iso_norm_series = iso_norm_series.fillna(0.0)
        iso_ok = iso_norm_series >= float(strict.iso_anom_min)
    else:
        iso_ok = pd.Series(True, index=df.index)

    # --- Base rules (except confidence) ---
    rules = (
        (vol >= float(strict.vol_surge_min)) &
        (priceZ >= float(strict.price_dis_z_abs_min)) &
        (gap >= float(strict.time_gap_burst_min)) &
        (impact >= float(strict.impact_min))
    )
    if bool(strict.require_pattern_spike) and "feat_pattern_spike" in df.columns:
        rules = rules & (pattern >= 1.0)

    # Candidates that pass all non-confidence rules
    cand = df[rules & iso_ok].copy()
    n_cand = len(cand)

    # Helper to pick top-K and set conf_cut accordingly
    def pick_top_k(dd: pd.DataFrame, k: int):
        picked = dd.sort_values("final_ai_score", ascending=False).head(k).copy()
        cut = float(picked["final_ai_score"].min()) if not picked.empty else None
        return picked, cut

    # Desired band of passes
    tgt_min = max(1, int(getattr(strict, "target_pass_min", 5)))
    tgt_max = max(tgt_min, int(getattr(strict, "target_pass_max", 20)))
    desired = min(max(10, tgt_min), tgt_max)  # center ~10

    # --- Path A: we have candidates after non-confidence rules ---
    if n_cand > 0:
        if bool(getattr(strict, "adaptive_conf", True)):
            # choose quantile on the candidate set to hit ~desired
            q = 1.0 - min(1.0, desired / n_cand)
            q = max(0.0, q)
            conf_dyn = float(cand["final_ai_score"].quantile(q))
        else:
            conf_dyn = float(df["final_ai_score"].quantile(float(strict.conf_quantile)))

        conf_cut = max(float(strict.conf_min), conf_dyn)

        # Apply confidence gate
        final_mask = rules & iso_ok & (conf >= conf_cut)
        out = df[final_mask].copy()

        # Fallback within candidate set: ensure at least 'desired'
        if out.empty:
            out, conf_cut = pick_top_k(cand, min(desired, n_cand))

        return out, conf_cut, iso_norm_series

    # --- Path B: no candidates -> relax thresholds by 25% ---
    relax = 0.75
    rules_relaxed = (
        (vol >= float(strict.vol_surge_min) * relax) &
        (priceZ >= float(strict.price_dis_z_abs_min) * relax) &
        (gap >= float(strict.time_gap_burst_min) * relax) &
        (impact >= float(strict.impact_min) * relax)
    )
    if bool(strict.require_pattern_spike) and "feat_pattern_spike" in df.columns:
        rules_relaxed = rules_relaxed & (pattern >= 1.0)

    cand2 = df[rules_relaxed & iso_ok].copy()
    if not cand2.empty:
        out, conf_cut = pick_top_k(cand2, min(desired, len(cand2)))
        return out, conf_cut, iso_norm_series

    # --- Path C: drop pattern_spike requirement entirely ---
    rules_relaxed2 = (
        (vol >= float(strict.vol_surge_min) * relax) &
        (priceZ >= float(strict.price_dis_z_abs_min) * relax) &
        (gap >= float(strict.time_gap_burst_min) * relax) &
        (impact >= float(strict.impact_min) * relax)
    )
    cand3 = df[rules_relaxed2 & iso_ok].copy()
    if not cand3.empty:
        out, conf_cut = pick_top_k(cand3, min(desired, len(cand3)))
        return out, conf_cut, iso_norm_series

    # --- Final fallback: top-K by confidence from full DF ---
    if "final_ai_score" in df.columns and not conf.isna().all():
        out, conf_cut = pick_top_k(df, min(desired, len(df)))
        return out, conf_cut, iso_norm_series

    # Nothing available
    return df.head(0).copy(), None, iso_norm_series

def _row_explanations(
    row,                         # pandas.Series
    strict,
    conf_cut,                    # float | None
    iso_norm_val,                # float | None
    weights                      # your ScoringWeights or similar
) -> list[dict]:
    expl = []

    # 1) Final ML confidence
    val = float(row.get("final_ai_score", 0.0))
    if conf_cut is not None:
        thr = float(conf_cut)
        passed = val >= thr  # higher => more suspicious
        expl.append({
            "signal": "final_ai_score",
            "value": round(val, 3),
            "threshold": round(thr, 3),
            "result": passed,
            "operator": ">=",
            "why": (
                "Overall ML confidence exceeds the strict threshold."
                if passed else
                "Overall ML confidence is below the strict threshold."
            ),
        })
    else:
        # No strict confidence threshold applied (e.g., adaptive top-K fallback)
        expl.append({
            "signal": "final_ai_score",
            "value": round(val, 3),
            "threshold": None,
            "result": True,  # row was selected anyway
            "operator": None,
            "why": "Selected via adaptive ranking (top-K by ML confidence).",
        })

    # 2) Drivers (include only if present)
    def add_driver(sig, v, thr, op, meaning):
        if v is None:
            return
        d = {"signal": sig, "value": round(float(v), 3)}
        if thr is not None: d["threshold"] = round(float(thr), 3)
        if op  is not None: d["operator"]  = op
        d["why"] = meaning
        expl.append(d)

    add_driver("feat_volume_surge",
            row.get("feat_volume_surge"),
            getattr(strict, "vol_surge_min", None),
            ">=",
            "Volume surge relative to baseline.")

    # price_dislocation can be signed; compare on absolute
    price_dis = row.get("feat_price_dislocation")
    if price_dis is not None:
        add_driver("feat_price_dislocation_abs",
                abs(float(price_dis)),
                getattr(strict, "price_dis_z_abs_min", None),
                ">=",
                "Absolute price dislocation (z-score).")

    add_driver("feat_time_gap_burst",
            row.get("feat_time_gap_burst"),
            getattr(strict, "time_gap_burst_min", None),
            ">=",
            "Burstiness in inter-trade time gaps.")

    add_driver("feat_impact_est",
            row.get("feat_impact_est"),
            getattr(strict, "impact_min", None),
            ">=",
            "Estimated market impact.")

    # pattern spike (optional)
    if "feat_pattern_spike" in row:
        add_driver("feat_pattern_spike",
                row.get("feat_pattern_spike"),
                1.0 if getattr(strict, "require_pattern_spike", False) else None,
                ">=" if getattr(strict, "require_pattern_spike", False) else None,
                "Pattern spike consistent with pump/dump signature.")

    # Iso anomaly (normalized)
    if iso_norm_val is not None:
        add_driver("iso_anom_norm",
                iso_norm_val,
                getattr(strict, "iso_anom_min", None),
                ">=",
                "Isolation-forest anomaly score (normalized).")

    return expl


def _attach_explanations(
    df_filtered: pd.DataFrame,
    strict: StrictParams,
    conf_cut: Optional[float],
    iso_norm_series: Optional[pd.Series],
    weights: ScoringWeights
) -> tuple[pd.DataFrame, list[list[dict]]]:
    iso_lookup = (iso_norm_series if iso_norm_series is not None
                else pd.Series(index=df_filtered.index, dtype=float))
    all_expl = []
    for idx, row in df_filtered.iterrows():
        iso_val = iso_lookup.get(idx, None) if iso_lookup is not None else None
        ex = _row_explanations(row, strict, conf_cut, iso_val, weights)
        all_expl.append(ex)
    df_with = df_filtered.copy()
    df_with["explanations_json"] = [
        json.dumps(ex, ensure_ascii=False, default=lambda o:
            float(o) if isinstance(o, (np.floating,)) else
            int(o)   if isinstance(o, (np.integer,))  else
            None     if (pd.isna(o) if hasattr(pd, "isna") else False) else
            str(o)
        )
        for ex in all_expl
    ]
    return df_with, all_expl

def _safe_expl(x):
    # Always return a list (never None/Null)
    return x if isinstance(x, list) else []

# ---------------- Endpoint ----------------

@router.post("/detect", response_model=DetectResponse)
def detect_pumpdump_ml(req: DetectRequest = Body(...)):
    out_dir = Path(req.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    save_dir = Path(req.save_dir) if req.save_dir else out_dir / "ML"
    save_dir.mkdir(parents=True, exist_ok=True)

    file_path = _find_latest_parquet_file(out_dir)
    df_all = _load_df(file_path)
    df = _filter_true_positives(df_all)
    if df.empty:
        return DetectResponse(
            message="No True Positive rows found in latest calibrated parquet.",
            model_summary={"note": "decision == 'True positive' not present or empty"},
            saved_parquet=None,
            saved_csv=None,
            count=0,
            features_built=[],
            scores_added=[],
            sample_columns=[],
            results=[]
        )

    df = _build_features(df, req.feat)
    feature_cols = [c for c in df.columns if c.startswith("feat_")]
    if not feature_cols:
        raise ValueError("No feature columns were built (feat_*). Check _build_features and input schema.")
    df = _manipulation_scoring(df, req.weights)
    score_cols = ["score_volume","score_time_gap","score_price_dev","score_impact","ml_confidence_score"]

    rf_prob = iso_raw = None
    model_summary: Dict[str, Any] = {}
    effective_label = req.label_column if (req.label_column and req.label_column in df.columns) else None

    if req.algo.use_random_forest:
        rf_pipe = _fit_random_forest(df, feature_cols, effective_label, req.seed)

        # <<< FIX: handle single-class RF >>>
        try:
            classes_ = rf_pipe.named_steps["rf"].classes_
            if len(classes_) >= 2:
                rf_prob = rf_pipe.predict_proba(df[feature_cols].values)[:, 1]
                df["rf_score"] = rf_prob
            else:
                # Single class; skip RF probability and continue gracefully
                rf_prob = None
                model_summary["rf_single_class_warning"] = True
        except Exception:
            # Any unexpected issue -> skip RF
            rf_prob = None
            model_summary["rf_predict_exception"] = True
        # <<< END FIX >>>

        if req.algo.save_models:
            model_dir = Path(req.algo.model_dir or (save_dir / "models"))
            model_dir.mkdir(parents=True, exist_ok=True)
            try:
                joblib.dump(rf_pipe, model_dir / "rf_pumpdump.joblib")
            except Exception:
                pass

        auc = None
        if effective_label is not None and len(df[effective_label].dropna().unique()) >= 2 and rf_prob is not None:
            y_true = df[effective_label].dropna().astype(int)
            y_pred = pd.Series(rf_prob, index=df.index).loc[y_true.index]
            try:
                auc = roc_auc_score(y_true, y_pred)
            except Exception:
                auc = None
        model_summary["random_forest_auc"] = auc
        model_summary["random_forest_supervised"] = bool(effective_label)
        model_summary["random_forest_label_used"] = effective_label

    if req.algo.use_isolation_forest:
        iso_pipe = _fit_isolation_forest(df, feature_cols, req.seed)
        iso_raw = iso_pipe["iso"].decision_function(iso_pipe["scaler"].transform(df[feature_cols].values))
        df["iso_raw_score"] = iso_raw
        if req.algo.save_models:
            model_dir = Path(req.algo.model_dir or (save_dir / "models"))
            model_dir.mkdir(parents=True, exist_ok=True)
            try:
                joblib.dump(iso_pipe, model_dir / "iso_pumpdump.joblib")
            except Exception:
                pass

    if req.algo.use_ensemble:
        ens = _ensemble_score(rf_prob, iso_raw)
        df["ensemble_score"] = ens if ens.size else 0.0
    else:
        df["ensemble_score"] = df.get("rf_score", df.get("iso_raw_score", 0.0))

    if "rf_score" in df and "ensemble_score" in df:
        base = df["ensemble_score"] if "ensemble_score" in df.columns else df.get("rf_score", 0.0)
        df["final_ai_score"] = 0.6 * base + 0.4 * df["ml_confidence_score"]
    else:
        df["final_ai_score"] = df["ml_confidence_score"]

    df_filt, conf_cut, iso_norm_series = _apply_strict_filter(df, req.strict)
    df_filt, explanations_list = _attach_explanations(df_filt, req.strict, conf_cut, iso_norm_series, req.weights)
    df_filt = _apply_banding(df_filt, req.bands)

    # NEW: safe read (won’t crash if client didn’t send meta_dir)
    meta_dir = getattr(req, "meta_dir", None)
    meta_df = None
    if meta_dir:
        try:
            meta_df = _load_df(_find_latest_parquet_file(Path(meta_dir)))
        except Exception:
            meta_df = None

    # NEW: ensure metadata columns
    df_filt = _ensure_metadata_cols_simple(df_filt, df_all, meta_df)

    result_cols = [c for c in RESULT_COLS_PREF if c in df_filt.columns]
    if not result_cols:
        result_cols = list(df_filt.columns)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = (req.output_basename or file_path.stem + "_ml") + f"_{ts}"
    out_parquet = (Path(req.save_dir) if req.save_dir else save_dir) / f"{base}.parquet"
    out_csv = (Path(req.save_dir) if req.save_dir else save_dir) / f"{base}.csv"
    df_filt[result_cols].to_parquet(out_parquet, index=False)
    df_filt[result_cols].to_csv(out_csv, index=False)

    records = df_filt[[c for c in result_cols if c != "explanations_json"]].to_dict(orient="records")
    results_json: List[Dict[str, Any]] = []
    for rec, ex in zip(records, explanations_list):
        rec["explanations"] = ex
        results_json.append(rec)

    scores_added = (
        (["rf_score"] if "rf_score" in df.columns else []) +
        (["iso_raw_score"] if "iso_raw_score" in df.columns else []) +
        ["ensemble_score","final_ai_score"] +
        score_cols
    )

    sample_cols = list({
    c for c in (["security_name","security_type","brokerage","symbol","timestamp","price","volume","rubric_score"] + feature_cols + scores_added)
    if c in df.columns
})


    model_summary.update({
        "rows_scored": int(len(df)),
        "rows_after_strict": int(len(df_filt)),
        "feature_count": int(len(feature_cols)),
        "models_used": {
            "random_forest": req.algo.use_random_forest,
            "isolation_forest": req.algo.use_isolation_forest,
            "ensemble": req.algo.use_ensemble,
        }
    })

    return DetectResponse(
        message="Pump & Dump ML evaluation complete (strict mode)",
        model_summary=model_summary,
        saved_parquet=str(out_parquet),
        saved_csv=str(out_csv),
        count=int(len(df_filt)),
        features_built=feature_cols,
        scores_added=scores_added,
        sample_columns=sample_cols[:30],
        results=results_json
    )
