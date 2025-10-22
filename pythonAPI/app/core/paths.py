# app/core/paths.py
from pathlib import Path

# project root = folder that contains "app" and "data"
PROJECT_ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = PROJECT_ROOT / "data"
SIMULATED_DIR = DATA_DIR / "simulated"
RESULTS_DIR = DATA_DIR / "results"
RESULTS_ML_DIR = RESULTS_DIR / "ML"
TEMPLATES_DIR = DATA_DIR / "templates"

def ensure_data_tree() -> None:
    for p in (SIMULATED_DIR, RESULTS_DIR, RESULTS_ML_DIR, TEMPLATES_DIR):
        p.mkdir(parents=True, exist_ok=True)
