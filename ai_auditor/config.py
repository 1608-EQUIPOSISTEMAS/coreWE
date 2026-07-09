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
MARKDOWN_DIR = ROOT_DIR / "markdown"
UPLOADS_DIR = ROOT_DIR / "uploads"
REPORTS_DIR = ROOT_DIR / "reports"
CACHE_DIR = ROOT_DIR / "cache"

PEDAGOGIA_PDF = PDFS_DIR / "pedagogia_2026.pdf"
BUENAS_PRACTICAS_PDF = PDFS_DIR / "manual_buenas_practicas_2024.pdf"

# Pedagogía viaja como Markdown (documento de mucho diseño y poco texto: el
# Markdown cuesta ~5x menos tokens que el PDF nativo). El manual, denso en
# texto, se mantiene como PDF nativo donde la tarifa plana por página es más
# eficiente y conserva fidelidad. Regenerar con pdf_to_markdown.py.
PEDAGOGIA_MD = MARKDOWN_DIR / "pedagogia_2026.md"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
GEMINI_CLASSIFIER_MODEL = os.getenv("GEMINI_CLASSIFIER_MODEL", "gemini-3.5-flash")

# Presupuesto de tokens de "thinking" de Gemini 2.5. Sin tope, el modelo gasta
# ~19K tokens de razonamiento por auditoría facturados a precio de output
# ($10/M en Pro): el grueso del costo. Un tope acotado mantiene la calidad del
# juicio estructurado a una fracción del costo. El clasificador apenas razona.
AUDITOR_THINKING_BUDGET = int(os.getenv("AUDITOR_THINKING_BUDGET", "4096"))
CLASSIFIER_THINKING_BUDGET = int(os.getenv("CLASSIFIER_THINKING_BUDGET", "512"))

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
    if not BUENAS_PRACTICAS_PDF.exists():
        raise FileNotFoundError(f"PDF no encontrado: {BUENAS_PRACTICAS_PDF}")
    if not PEDAGOGIA_MD.exists():
        raise FileNotFoundError(
            f"Markdown de pedagogía no encontrado: {PEDAGOGIA_MD}. "
            "Generalo con: python pdf_to_markdown.py"
        )
