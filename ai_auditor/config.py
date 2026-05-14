"""Configuración global del System Auditor.

Lee variables de entorno desde .env y expone rutas absolutas
del proyecto para evitar problemas de cwd al ejecutar scripts.
"""
from pathlib import Path
from dotenv import load_dotenv
import os

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

PDFS_DIR = ROOT_DIR / "pdfs"
UPLOADS_DIR = ROOT_DIR / "uploads"
REPORTS_DIR = ROOT_DIR / "reports"
CACHE_DIR = ROOT_DIR / "cache"

PEDAGOGIA_PDF = PDFS_DIR / "pedagogia_2026.pdf"
BUENAS_PRACTICAS_PDF = PDFS_DIR / "manual_buenas_practicas_2024.pdf"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")
GEMINI_CLASSIFIER_MODEL = os.getenv("GEMINI_CLASSIFIER_MODEL", "gemini-2.5-flash")

WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "medium")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

THEORY_TARGET_PCT = float(os.getenv("THEORY_TARGET_PCT", "20"))
THEORY_TOLERANCE_PCT = float(os.getenv("THEORY_TOLERANCE_PCT", "10"))
SEGMENT_DURATION_SEC = int(os.getenv("SEGMENT_DURATION_SEC", "60"))


def theory_range() -> tuple[float, float]:
    """Devuelve el rango aceptable de % teórico según target ± tolerancia."""
    return (
        max(0.0, THEORY_TARGET_PCT - THEORY_TOLERANCE_PCT),
        min(100.0, THEORY_TARGET_PCT + THEORY_TOLERANCE_PCT),
    )


def assert_ready() -> None:
    """Falla rápido si falta configuración crítica."""
    if not GEMINI_API_KEY:
        raise RuntimeError("Falta GEMINI_API_KEY en .env")
    for pdf in (PEDAGOGIA_PDF, BUENAS_PRACTICAS_PDF):
        if not pdf.exists():
            raise FileNotFoundError(f"PDF no encontrado: {pdf}")
