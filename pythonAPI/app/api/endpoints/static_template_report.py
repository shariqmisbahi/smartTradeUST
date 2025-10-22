from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from app.core.paths import TEMPLATES_DIR


try:
    from app.core.paths import TEMPLATES_DIR
except ModuleNotFoundError:
    from core.paths import TEMPLATES_DIR


router = APIRouter(tags=["reports"])

PDF_PATH = (TEMPLATES_DIR / "report.pdf")  

@router.get("/reports/template", response_class=FileResponse, summary="Download the static report.pdf")
def get_static_template_report():
    if not PDF_PATH.exists() or not PDF_PATH.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {PDF_PATH}")
    return FileResponse(str(PDF_PATH), media_type="application/pdf", filename=PDF_PATH.name)
