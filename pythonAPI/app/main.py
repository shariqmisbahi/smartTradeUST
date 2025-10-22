# app/main.py
from __future__ import annotations

# --- Ensure project root is on sys.path even when running from /app ---
import sys
from pathlib import Path

_here = Path(__file__).resolve()
_project_root = _here.parent.parent  # …/pythonAPI
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.paths import ensure_data_tree

# Bootstrap ./data/*
ensure_data_tree()

TAGS_METADATA = [
    {"name": "Get – Read (Parquet)", "description": "Read latest generated Parquet and filter scenarios."},
]

app = FastAPI(
    title="Trade Surveillance Backend",
    description="Backend exposing selected endpoints only",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=TAGS_METADATA,  # show tag group in Swagger
    root_path="/api",  # For serving behind reverse proxy at /api/*
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://smart-trade.ustsea.com",  # Production (Cloudflare tunnel)
        "http://localhost:4100",            # Local development
        "http://127.0.0.1:4100",            # Local development
        "http://smarttrade-ui:4100",        # Docker internal
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Import routers normally (now that sys.path is fixed)
from app.api.endpoints.simulate_data_sgx import router as simulate_router
from app.api.endpoints.pumpdump_calibaration import router as pumpdump_calib_router
from app.api.endpoints.insiderTrading_calibaration import router as insider_calib_router
from app.api.endpoints.pumpdump_ml_engine import router as pumpdump_ml_router
from app.api.endpoints.static_template_report import router as static_template_report_router

# ⬇️ This router exposes BOTH:
#    GET /simulate/alerts/latest/pumpdump
#    GET /simulate/alerts/latest/insidertrading
from app.api.endpoints.read_latest_pumpdump_insider_data import router as simulate_read_router

# Optional:
try:
    from app.api.endpoints.reports_ml import router as reports_ml_router
except Exception:
    reports_ml_router = None

# Register ONLY the selected routers
app.include_router(simulate_router)                # /simulate
app.include_router(pumpdump_calib_router)          # /simulate/alerts
app.include_router(insider_calib_router)           # /insidertrading
app.include_router(pumpdump_ml_router)             # /pumpdumpml
app.include_router(static_template_report_router)  # /reports/template

# ✅ NEW: include the router that contains BOTH "latest" endpoints
app.include_router(simulate_read_router, tags=["Get – Read (Parquet)"])

if reports_ml_router:
    app.include_router(reports_ml_router)          # /reports/ml/high-risk.pdf

# --- CLI runner: python main.py --mode fastapi ---
if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="fastapi")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", default=True)
    args = parser.parse_args()

    if args.mode.lower() == "fastapi":
        # Ensure project root is on sys.path so "app.main:app" is importable even when running from /app
        here = Path(__file__).resolve()
        project_root = here.parent.parent
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))

        # Use IMPORT STRING so reload/workers work properly
        uvicorn.run(
            "app.main:app",           # import string
            host=args.host,
            port=args.port,
            reload=args.reload,
            factory=False,
        )
    else:
        print(f"Unknown mode: {args.mode}")
