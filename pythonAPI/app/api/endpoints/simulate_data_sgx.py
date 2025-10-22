from __future__ import annotations
import os
import random
import string
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import APIRouter, Body
from pydantic import BaseModel, Field, model_validator


router = APIRouter(prefix="/simulate", tags=["SimulateData like NNASDAQ 'SMART'"])  # same as original :contentReference[oaicite:16]{index=16}

# --- dual import for running from project root or from /app ---
try:
    from app.core.paths import SIMULATED_DIR, RESULTS_DIR
except ModuleNotFoundError:
    from core.paths import SIMULATED_DIR, RESULTS_DIR

# -----------------------------
# Constants / vocab
# -----------------------------
EXCHANGE_ID = "SGX"                  # targeted exchange is SGX only
TIMEZONE = "Asia/Singapore"          # SGX local time (UTC+08)
MESSAGE_TYPE = "ALERT"

# Representative SGX equities (feel free to extend)
SGX_TICKERS = [
    ("DBS Group Holdings Ltd", "EQUITY"),
    ("Oversea-Chinese Banking Corp", "EQUITY"),
    ("United Overseas Bank Ltd", "EQUITY"),
    ("SATS Ltd", "EQUITY"),
    ("Singapore Airlines Ltd", "EQUITY"),
    ("Keppel Corp Ltd", "EQUITY"),
    ("Sembcorp Industries Ltd", "EQUITY"),
    ("CapitaLand Investment Ltd", "EQUITY"),
    ("Mapletree Logistics Trust", "REIT"),
    ("Ascendas REIT", "REIT"),
    ("City Developments Ltd", "EQUITY"),
    ("Wilmar International Ltd", "EQUITY"),
    ("Genting Singapore Ltd", "EQUITY"),
    ("Yangzijiang Shipbuilding Hldgs", "EQUITY"),
    ("ST Engineering Ltd", "EQUITY"),
    ("Thai Beverage PCL", "EQUITY"),
    ("Jardine Cycle & Carriage Ltd", "EQUITY"),
    ("Frasers Centrepoint Trust", "REIT"),
    ("Keppel DC REIT", "REIT"),
    ("CapitaLand Ascott Trust", "REIT"),
    ("SIA Engineering Company Ltd", "EQUITY"),
    ("ComfortDelGro Corporation", "EQUITY"),
    ("iFAST Corporation Ltd", "EQUITY"),
    ("Nanofilm Technologies Intl", "EQUITY"),
    ("Rex International Holding", "EQUITY"),
    ("Seatrium Ltd", "EQUITY"),
]

BROKERS = [
    "SGX-BROK-01", "SGX-BROK-02", "SGX-BROK-03", "SGX-BROK-04",
    "SGX-BROK-05", "SGX-BROK-06", "SGX-BROK-07", "SGX-BROK-08",
]

BROKERAGES = [
    "SG Brokerage Pte Ltd",
    "Lion City Securities",
    "Merlion Capital",
    "Marina Bay Brokers",
    "Raffles Street Securities",
    "HarbourFront Capital",
    "Orchard Financial Markets",
    "Sentosa Ridge Investments",
    "Bukit Timah Partners",
    "East Coast Securities",
]

TRADERS = ["TRD001", "TRD002", "TRD003", "TRD004", "TRD005", "TRD006"]
ACCOUNT_TYPES = ["RETAIL", "INSTITUTION"]
MARKET_SIDES = ["BUY", "SELL"]
ORDER_TYPES = ["LIMIT", "MARKET"]
EXEC_INSTR = ["NONE", "IOC", "FOK", "AON"]

# SGX typical trading sessions (local time)
MORNING_OPEN = time(9, 0)
MORNING_CLOSE = time(12, 0)
AFTERNOON_OPEN = time(13, 0)
AFTERNOON_CLOSE = time(17, 0)

# -----------------------------
# Alert taxonomy, behaviour, weights
# -----------------------------
ALERT_TAXONOMY: Dict[str, List[Tuple[str, str]]] = {
    "Fraudulent Behaviour / Breach of Fiduciary Duty": [
        ("Front Running / Firm Trades",
         "Broker places firm order ahead of a known client block to profit from expected price move."),
        ("Insider Trading",
         "Trading based on material, non-public information about the company."),
        ("Front Running of Research",
         "Trading on knowledge of forthcoming research to benefit from the post-publication move."),
    ],
    "Price / Volume Manipulation": [
        ("Pump and Dump",
         "Price is aggressively lifted (pump) via buys, followed by profit-taking sells (dump)."),
        ("Ramping",
         "Artificially inflating price via aggressive buying to ignite momentum."),
        ("Spoofing",
         "Placing large deceptive orders with intent to cancel to mislead market interest."),
        ("Layering",
         "Placing multiple orders at different levels to create false depth and move price."),
        ("Wash Trades",
         "Simultaneous buy and sell of same instrument to fake activity."),
        ("Wash & Cross Trades",
         "Wash-like prints across accounts, often within same firm."),
        ("Marking the Open/Close",
         "Trades targeting open/close to influence reference prices."),
        ("Churning",
         "Excessive client account turnover to generate commissions."),
        ("Large / Block Trades",
         "Unusually large prints likely to impact or signal manipulation."),
        ("Barrier / Expiry Option Pricing",
         "Trades intended to pin/peg underlying around option expiry to render options worthless."),
        ("Odd Lots",
         "Abnormal odd-lot prints used to manipulate prints/perception."),
        ("Pegging",
         "Illegally steering price near option expiry to render options worthless."),
    ],
}

ALERT_BEHAVIOUR_HINTS: Dict[str, Dict] = {
    "Pump and Dump": {"side_bias": None, "vol_mult": (4.0, 10.0), "price_jitter_bps": (80, 350)},
    "Ramping": {"side_bias": "BUY", "vol_mult": (3.0, 8.0), "price_jitter_bps": (30, 250)},
    "Spoofing": {"side_bias": None, "vol_mult": (2.0, 5.0), "price_jitter_bps": (5, 60)},
    "Layering": {"side_bias": None, "vol_mult": (2.0, 4.0), "price_jitter_bps": (5, 40)},
    "Wash Trades": {"side_bias": None, "vol_mult": (1.5, 3.0), "price_jitter_bps": (0, 10)},
    "Wash & Cross Trades": {"side_bias": None, "vol_mult": (2.0, 4.0), "price_jitter_bps": (5, 20)},
    "Marking the Open/Close": {"side_bias": None, "vol_mult": (2.0, 4.0), "price_jitter_bps": (10, 120)},
    "Churning": {"side_bias": None, "vol_mult": (1.5, 2.5), "price_jitter_bps": (5, 20)},
    "Large / Block Trades": {"side_bias": None, "vol_mult": (5.0, 12.0), "price_jitter_bps": (0, 30)},
    "Barrier / Expiry Option Pricing": {"side_bias": None, "vol_mult": (1.5, 3.5), "price_jitter_bps": (20, 120)},
    "Odd Lots": {"side_bias": None, "vol_mult": (1.0, 1.5), "price_jitter_bps": (0, 10)},
    "Pegging": {"side_bias": None, "vol_mult": (2.0, 4.5), "price_jitter_bps": (20, 90)},
    "Front Running / Firm Trades": {"side_bias": None, "vol_mult": (2.0, 5.0), "price_jitter_bps": (20, 100)},
    "Insider Trading": {"side_bias": None, "vol_mult": (2.0, 6.0), "price_jitter_bps": (30, 150)},
    "Front Running of Research": {"side_bias": None, "vol_mult": (2.0, 5.0), "price_jitter_bps": (20, 120)},
}

DEFAULT_ALERT_WEIGHTS: Dict[str, float] = {
    "Pump and Dump": 0.16,
    "Ramping": 0.12,
    "Spoofing": 0.11,
    "Layering": 0.08,
    "Wash Trades": 0.07,
    "Wash & Cross Trades": 0.05,
    "Marking the Open/Close": 0.06,
    "Churning": 0.05,
    "Large / Block Trades": 0.05,
    "Barrier / Expiry Option Pricing": 0.04,
    "Odd Lots": 0.03,
    "Pegging": 0.04,
    "Front Running / Firm Trades": 0.07,
    "Insider Trading": 0.04,
    "Front Running of Research": 0.03,
}

# -----------------------------
# MANDATORY COLUMNS
# -----------------------------
COMMON_MANDATORY_COLS = [
    "alert_id", "report_short_name", "security_type", "security_name", "brokerage",
    "alert_type_category", "alert_type_description", "comments",
    "exchange_id", "message_type", "date", "time",
    "order_id", "trade_id", "market_side",
    "price", "total_volume", "value",
    "account", "account_type", "broker", "trader",
    "order_type", "executions_instructions",
    "order_received_date", "order_received_time",
    "order_code", "amend_received_datetime", "cancel_reason",
]

PUMP_DUMP_MANDATORY_COLS = [
    "pd_leg", "pd_leg_index", "pd_pair_id", "pd_pump_price", "pd_dump_price",
]

# ✅ Updated: include identifiers for Insider Trading
INSIDER_MANDATORY_COLS = [
    "insider_mnpi_flag", "insider_relation", "insider_event_type", "insider_event_datetime",
    "insider_pre_event_return_pct", "insider_post_event_return_pct",
    "insider_linkage_score", "insider_suspicious_profit",
    "isin",  # 12-char ISIN with valid checksum
    "cusip", # 9-char CUSIP (left None for SGX)
]

ALL_SCENARIO_MANDATORY = PUMP_DUMP_MANDATORY_COLS + INSIDER_MANDATORY_COLS

# -----------------------------
# Request/response models
# -----------------------------
class GenerateRequest(BaseModel):
    start: date = Field(default_factory=lambda: (date.today() - timedelta(days=3)))
    end: date = Field(default_factory=date.today)
    alerts_per_day: int = Field(default=2000, ge=1, le=20000)
    out_dir: Optional[str] = Field(default=str(SIMULATED_DIR))  
    seed: Optional[int] = Field(default=None)
    alert_weights: Optional[Dict[str, float]] = Field(default=None)



    start: date = Field(default_factory=lambda: (date.today() - timedelta(days=3)))
    end: date = Field(default_factory=date.today)
    alerts_per_day: int = Field(default=2000, ge=1, le=20000)
    out_dir: Optional[str] = Field(default=str(SIMULATED_DIR))  #
    seed: Optional[int] = Field(default=None)
    alert_weights: Optional[Dict[str, float]] = Field(default=None)



class GenerateResponse(BaseModel):
    message: str
    count: int
    csv_path: str
    parquet_path: str
    sample: List[dict]

router = APIRouter(prefix="/simulate", tags=["Generate Trades Alerts like NASDAQ 'SMART'"])

# -----------------------------
# Helpers
# -----------------------------
def _rng(seed: Optional[int]) -> None:
    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)

def _pick_session_time(d: date) -> datetime:
    morning_prob = 3 / 7
    if random.random() < morning_prob:
        hh = random.randint(MORNING_OPEN.hour, MORNING_CLOSE.hour - 1)
        mm = random.randint(0, 59)
    else:
        hh = random.randint(AFTERNOON_OPEN.hour, AFTERNOON_CLOSE.hour - 1)
        mm = random.randint(0, 59)
    ss = random.randint(0, 59)
    return datetime(d.year, d.month, d.day, hh, mm, ss)

def _rand_code(prefix: str, n: int = 8) -> str:
    return f"{prefix}-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=n))

def _choose_alert(alert_weights: Dict[str, float]) -> Tuple[str, str, str]:
    short_names = list(alert_weights.keys())
    probs = np.array([alert_weights[s] for s in short_names], dtype=float)
    probs = probs / probs.sum()
    chosen_short = np.random.choice(short_names, p=probs)
    for cat, items in ALERT_TAXONOMY.items():
        for sn, desc in items:
            if sn == chosen_short:
                return cat, sn, desc
    return "Unknown", chosen_short, ""

def _price_seed_for_security(sec_name: str) -> float:
    bucket = sum(ord(c) for c in sec_name) % 5
    ranges = [(0.80, 3.00),(3.00, 8.00),(8.00, 20.0),(20.0, 40.0),(40.0, 90.0)]
    low, high = ranges[bucket]
    return round(random.uniform(low, high), 2)

def _apply_alert_behaviour(short_name: str, base_price: float) -> Tuple[float, float, Optional[str]]:
    hint = ALERT_BEHAVIOUR_HINTS.get(short_name, {})
    bps_low, bps_high = hint.get("price_jitter_bps", (0, 50))
    bps = random.uniform(bps_low, bps_high)
    price = max(0.01, base_price * (1 + bps / 10000.0))
    vol_low, vol_high = hint.get("vol_mult", (1.0, 2.0))
    vol_mult = random.uniform(vol_low, vol_high)
    side_bias = hint.get("side_bias")
    return price, vol_mult, side_bias

def _maybe(value: str, p: float = 0.2) -> Optional[str]:
    return value if random.random() < p else None

def _normalize_weights(custom: Optional[Dict[str, float]]) -> Dict[str, float]:
    if not custom:
        return DEFAULT_ALERT_WEIGHTS.copy()
    cleaned = {k: float(v) for k, v in custom.items() if k in DEFAULT_ALERT_WEIGHTS}
    for k, v in DEFAULT_ALERT_WEIGHTS.items():
        cleaned.setdefault(k, v * 0.0001)
    total = sum(cleaned.values())
    if total <= 0:
        return DEFAULT_ALERT_WEIGHTS.copy()
    return {k: v / total for k, v in cleaned.items()}

# -----------------------------
# Identifier helpers (ISIN/CUSIP)
# -----------------------------
def _to_isin_digits(s: str) -> str:
    """Convert letters to numbers (A=10,...,Z=35), keep digits."""
    out = []
    for ch in s:
        if ch.isdigit():
            out.append(ch)
        else:
            out.append(str(ord(ch.upper()) - 55))  # A=65 -> 10
    return "".join(out)

def _luhn_checksum(num_str: str) -> int:
    """Luhn mod-10 checksum for a string of digits."""
    total = 0
    # process from rightmost, doubling every second digit
    reverse = num_str[::-1]
    for i, ch in enumerate(reverse):
        n = int(ch)
        if i % 2 == 0:
            total += n
        else:
            d = n * 2
            total += d if d < 10 else (d - 9)
    return (10 - (total % 10)) % 10

def _gen_isin(country: str = "SG") -> str:
    """Generate a syntactically valid ISIN for SGX: CC + 9 base + 1 checksum."""
    # 9-character NSIN: alphanumeric
    nsin = "".join(random.choices(string.ascii_uppercase + string.digits, k=9))
    base = country.upper() + nsin
    digits = _to_isin_digits(base)
    chk = _luhn_checksum(digits)
    return base + str(chk)

def _gen_cusip() -> str:
    """Generate a 9-char CUSIP-like code (not used for SGX; kept None)."""
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=9))

# -----------------------------
# Scenario value helpers
# -----------------------------
_INSIDER_RELATIONS = ["Employee", "Director", "Supplier", "Consultant", "Analyst", "Unknown"]
_INSIDER_EVENTS = ["Earnings", "M&A", "Guidance", "Resignation", "Regulatory", "Litigation"]

def _gen_insider_fields(base_ts: datetime) -> Dict[str, object]:
    event_dt = base_ts + timedelta(hours=random.randint(1, 72))
    pre_ret = round(random.uniform(-5.0, 5.0), 3)
    post_ret = round(random.uniform(-10.0, 10.0), 3)
    return {
        "insider_mnpi_flag": True,
        "insider_relation": random.choice(_INSIDER_RELATIONS),
        "insider_event_type": random.choice(_INSIDER_EVENTS),
        "insider_event_datetime": event_dt.isoformat(sep=" "),
        "insider_pre_event_return_pct": pre_ret,
        "insider_post_event_return_pct": post_ret,
        "insider_linkage_score": round(random.uniform(0.55, 0.98), 3),
        "insider_suspicious_profit": round(random.uniform(5_000, 250_000), 2),
        "isin": _gen_isin("SG"),
        "cusip": None,  # SGX doesn’t generally use CUSIP; keep as None
    }

def _blank_insider_fields() -> Dict[str, object]:
    return {k: None for k in INSIDER_MANDATORY_COLS}

def _pump_dump_common_fields(pump_price: float, dump_price: float, leg: str, leg_index: int, alert_id: str) -> Dict[str, object]:
    return {
        "pd_leg": leg,  # "PUMP" or "DUMP"
        "pd_leg_index": leg_index,
        "pd_pair_id": alert_id,
        "pd_pump_price": pump_price,
        "pd_dump_price": dump_price,
    }

def _blank_pump_dump_fields() -> Dict[str, object]:
    return {k: None for k in PUMP_DUMP_MANDATORY_COLS}

# -----------------------------
# Pump & Dump two-leg generator
# -----------------------------
def _generate_pump_dump_pair(
    d: date,
    sec_name: str,
    sec_type: str,
    base_price: float,
    alert_id: str,
    brokerage: str,
    broker: str,
    trader: str,
    account: str,
    account_type: str,
    order_code: str,
    exec_instr: str,
    order_type: str,
) -> List[dict]:
    start_ts = datetime(d.year, d.month, d.day,
                        random.randint(AFTERNOON_OPEN.hour, AFTERNOON_CLOSE.hour - 2),
                        random.randint(0, 59), random.randint(0, 59))
    mid_ts = start_ts + timedelta(minutes=random.randint(5, 25))
    end_ts = mid_ts + timedelta(minutes=random.randint(3, 20))

    pump_up_pct = random.uniform(0.06, 0.25)
    dump_dn_pct = random.uniform(0.08, 0.35)

    pump_price = round(max(0.01, base_price * (1 + pump_up_pct)), 4)
    dump_price = round(max(0.01, pump_price * (1 - dump_dn_pct)), 4)

    pump_vol = int(random.randint(15_000, 80_000) * random.uniform(1.1, 2.2))
    dump_vol = int(pump_vol * random.uniform(0.7, 1.0))

    category = "Price / Volume Manipulation"
    short_name = "Pump and Dump"
    desc = "Two-legged event: BUY-driven pump leg followed by SELL-driven dump leg."

    recv_pump = start_ts - timedelta(minutes=random.randint(1, 15), seconds=random.randint(0, 59))
    recv_dump = mid_ts - timedelta(minutes=random.randint(1, 10), seconds=random.randint(0, 59))

    amend_pump = None
    if random.random() < 0.10:
        amend_pump = start_ts - timedelta(minutes=random.randint(0, 10))

    cancel_reason = None
    if random.random() < 0.05:
        cancel_reason = random.choice(["User Cancel", "Replace by Client", "Risk Limit"])

    rows = []

    # PUMP LEG (BUY)
    base_row = {
        "alert_id": alert_id,
        "report_short_name": short_name,
        "security_type": sec_type,
        "security_name": sec_name,
        "brokerage": brokerage,
        "alert_type_category": category,
        "alert_type_description": desc,
        "comments": "phase=pump",
        "exchange_id": EXCHANGE_ID,
        "message_type": MESSAGE_TYPE,
        "date": start_ts.date().isoformat(),
        "time": start_ts.time().isoformat(timespec="seconds"),
        "order_id": _rand_code("ORD"),
        "trade_id": _rand_code("TRD"),
        "market_side": "BUY",
        "price": pump_price,
        "total_volume": pump_vol,
        "value": round(pump_price * pump_vol, 2),
        "account": account,
        "account_type": account_type,
        "broker": broker,
        "trader": trader,
        "order_type": order_type,
        "executions_instructions": exec_instr,
        "order_received_date": recv_pump.date().isoformat(),
        "order_received_time": recv_pump.time().isoformat(timespec="seconds"),
        "order_code": order_code,
        "amend_received_datetime": amend_pump.isoformat(sep=" ") if amend_pump else None,
        "cancel_reason": None,
    }
    base_row.update(_pump_dump_common_fields(pump_price, dump_price, "PUMP", 0, alert_id))
    base_row.update(_blank_insider_fields())
    rows.append(base_row)

    # DUMP LEG (SELL)
    base_row2 = {
        "alert_id": alert_id,
        "report_short_name": short_name,
        "security_type": sec_type,
        "security_name": sec_name,
        "brokerage": brokerage,
        "alert_type_category": category,
        "alert_type_description": desc,
        "comments": "phase=dump",
        "exchange_id": EXCHANGE_ID,
        "message_type": MESSAGE_TYPE,
        "date": end_ts.date().isoformat(),
        "time": end_ts.time().isoformat(timespec="seconds"),
        "order_id": _rand_code("ORD"),
        "trade_id": _rand_code("TRD"),
        "market_side": "SELL",
        "price": dump_price,
        "total_volume": dump_vol,
        "value": round(dump_price * dump_vol, 2),
        "account": account,
        "account_type": account_type,
        "broker": broker,
        "trader": trader,
        "order_type": order_type,
        "executions_instructions": exec_instr,
        "order_received_date": recv_dump.date().isoformat(),
        "order_received_time": recv_dump.time().isoformat(timespec="seconds"),
        "order_code": order_code,
        "amend_received_datetime": None,
        "cancel_reason": cancel_reason,
    }
    base_row2.update(_pump_dump_common_fields(pump_price, dump_price, "DUMP", 1, alert_id))
    base_row2.update(_blank_insider_fields())
    rows.append(base_row2)

    return rows

# -----------------------------
# Day generator
# -----------------------------
def _generate_rows_for_day(
    d: date,
    alerts_per_day: int,
    alert_weights: Dict[str, float],
) -> List[dict]:
    rows: List[dict] = []
    for _ in range(alerts_per_day):
        (sec_name, sec_type) = random.choice(SGX_TICKERS)
        base_price = _price_seed_for_security(sec_name)

        category, short_name, desc = _choose_alert(alert_weights)

        broker = random.choice(BROKERS)
        brokerage = random.choice(BROKERAGES)
        trader = random.choice(TRADERS)
        account_type = random.choice(ACCOUNT_TYPES)
        account = f"{account_type[:3]}-{random.randint(100000, 999999)}"
        order_type = random.choice(ORDER_TYPES)
        exec_instr = random.choice(EXEC_INSTR)
        alert_id = _rand_code("ALRT")
        order_code = _rand_code("OC")

        if short_name == "Pump and Dump":
            rows.extend(
                _generate_pump_dump_pair(
                    d=d,
                    sec_name=sec_name,
                    sec_type=sec_type,
                    base_price=base_price,
                    alert_id=alert_id,
                    brokerage=brokerage,
                    broker=broker,
                    trader=trader,
                    account=account,
                    account_type=account_type,
                    order_code=order_code,
                    exec_instr=exec_instr,
                    order_type=order_type,
                )
            )
            continue

        ts = _pick_session_time(d)
        price, vol_mult, side_bias = _apply_alert_behaviour(short_name, base_price)
        market_side = side_bias if side_bias else random.choice(["BUY", "SELL"])

        base_vol = random.randint(1_000, 50_000)
        total_volume = int(base_vol * vol_mult)
        value = round(price * total_volume, 2)

        recv_delta = timedelta(minutes=random.randint(1, 45), seconds=random.randint(0, 59))
        order_received_dt = ts - recv_delta

        amend_dt = None
        cancel_reason = None
        if random.random() < 0.12:
            amend_dt = ts - timedelta(minutes=random.randint(0, 15))
        if random.random() < 0.10:
            cancel_reason = random.choice(["User Cancel", "Price Moved", "Replace by Client", "Risk Limit"])

        comments = _maybe("Flagged by rules engine for post-trade review.", p=0.35)

        row = {
            "alert_id": alert_id,
            "report_short_name": short_name,
            "security_type": sec_type,
            "security_name": sec_name,
            "brokerage": brokerage,
            "alert_type_category": category,
            "alert_type_description": desc,
            "comments": comments,
            "exchange_id": EXCHANGE_ID,
            "message_type": MESSAGE_TYPE,
            "date": ts.date().isoformat(),
            "time": ts.time().isoformat(timespec="seconds"),
            "order_id": _rand_code("ORD"),
            "trade_id": _rand_code("TRD"),
            "market_side": market_side,
            "price": round(price, 4),
            "total_volume": total_volume,
            "value": value,
            "account": account,
            "account_type": account_type,
            "broker": broker,
            "trader": trader,
            "order_type": order_type,
            "executions_instructions": exec_instr,
            "order_received_date": order_received_dt.date().isoformat(),
            "order_received_time": order_received_dt.time().isoformat(timespec="seconds"),
            "order_code": order_code,
            "amend_received_datetime": amend_dt.isoformat(sep=" ") if amend_dt else None,
            "cancel_reason": cancel_reason,
        }

        if short_name == "Insider Trading":
            row.update(_blank_pump_dump_fields())
            row.update(_gen_insider_fields(ts))
        else:
            row.update(_blank_pump_dump_fields())
            row.update(_blank_insider_fields())

        rows.append(row)
    return rows

# -----------------------------
# IO helpers
# -----------------------------
def _ensure_dir(path: str) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)

def _save_outputs(df: pd.DataFrame, out_dir: str, start: date, end: date) -> Tuple[str, str]:
    df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]
    _ensure_dir(out_dir)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = f"sgx_alerts_{start.isoformat()}_{end.isoformat()}_{stamp}"
    csv_path = os.path.join(out_dir, f"{base}.csv")
    parquet_path = os.path.join(out_dir, f"{base}.parquet")
    df.to_csv(csv_path, index=False)
    df.to_parquet(parquet_path, index=False)
    return csv_path, parquet_path

# -----------------------------
# Endpoint
# -----------------------------
@router.post(
    "/alerts",
    response_model=GenerateResponse,
    summary="Generate SGX dummy alerts (CSV + Parquet)",
    operation_id="simulate_sgx_trades_alerts_post",
)
def generate_alerts(req: GenerateRequest = Body(...)) -> GenerateResponse:
    """
    Generate synthetic SGX alerts across a date range and save to CSV + Parquet.

    Ensures scenario-mandatory columns for:
      • 'Insider Trading' -> insider_* fields + ISIN (valid checksum) + cusip(None on SGX)
      • 'Pump and Dump'   -> pd_* two-leg fields
    Non-applicable scenarios still carry these columns as None for schema stability.
    """
    _rng(req.seed)

    dates: List[date] = []
    d = req.start
    while d <= req.end:
        dates.append(d)
        d += timedelta(days=1)

    weights = _normalize_weights(req.alert_weights)
    all_rows: List[dict] = []
    for day in dates:
        all_rows.extend(_generate_rows_for_day(day, req.alerts_per_day, weights))

    df = pd.DataFrame(all_rows)

    # Ensure every mandatory column exists (fill if missing)
    for col in COMMON_MANDATORY_COLS + ALL_SCENARIO_MANDATORY:
        if col not in df.columns:
            df[col] = None

    # Stable column order
    preferred_cols = [
        # Alert meta
        "alert_id", "report_short_name", "security_type", "security_name", "brokerage",
        "alert_type_category", "alert_type_description", "comments",
        # Event/Order/Trade
        "exchange_id", "message_type", "date", "time", "order_id", "trade_id", "market_side",
        "price", "total_volume", "value", "account", "account_type", "broker", "trader",
        "order_type", "executions_instructions", "order_received_date", "order_received_time",
        "order_code", "amend_received_datetime", "cancel_reason",
        # Pump & Dump
        "pd_leg", "pd_leg_index", "pd_pair_id", "pd_pump_price", "pd_dump_price",
        # Insider (incl. identifiers)
        "insider_mnpi_flag", "insider_relation", "insider_event_type", "insider_event_datetime",
        "insider_pre_event_return_pct", "insider_post_event_return_pct",
        "insider_linkage_score", "insider_suspicious_profit",
        "isin", "cusip",
    ]
    cols = [c for c in preferred_cols if c in df.columns] + [c for c in df.columns if c not in preferred_cols]
    df = df[cols]

    csv_path, parquet_path = _save_outputs(df, req.out_dir, req.start, req.end)
    sample_records = df.head(5).to_dict(orient="records")

    return GenerateResponse(
        message=f"Generated SGX alerts from {req.start} to {req.end} with {req.alerts_per_day} alerts/day.",
        count=len(df),
        csv_path=csv_path,
        parquet_path=parquet_path,
        sample=sample_records
    )
