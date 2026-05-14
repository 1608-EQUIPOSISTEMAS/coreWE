"""Carga y caché del texto de los PDFs de metodología.

Los PDFs (Pedagogía 2026 y Manual Buenas Prácticas) son contenido estable:
no cambian entre auditorías. Por eso los extraemos una sola vez y guardamos
el texto plano en /cache. Las siguientes invocaciones leen del caché en ms.

El hash del PDF se incluye en el caché: si algún día reemplazan el PDF,
el caché se invalida automáticamente.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader

from config import PEDAGOGIA_PDF, BUENAS_PRACTICAS_PDF, CACHE_DIR

CACHE_FILE = CACHE_DIR / "pdf_texts.json"


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _extract_text(pdf_path: Path) -> str:
    reader = PdfReader(pdf_path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append(f"[Página {i}]\n{text.strip()}")
    return "\n\n".join(pages)


def load_methodology_pdfs(force_refresh: bool = False) -> dict[str, str]:
    """Devuelve {'pedagogia': texto, 'buenas_practicas': texto}.

    Usa caché en disco. Si el hash del PDF cambia, re-extrae automáticamente.
    """
    targets = {
        "pedagogia": PEDAGOGIA_PDF,
        "buenas_practicas": BUENAS_PRACTICAS_PDF,
    }

    current_hashes = {key: _file_hash(p) for key, p in targets.items()}

    if not force_refresh and CACHE_FILE.exists():
        cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if cached.get("hashes") == current_hashes:
            return cached["texts"]

    texts = {key: _extract_text(p) for key, p in targets.items()}

    CACHE_FILE.write_text(
        json.dumps({"hashes": current_hashes, "texts": texts}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return texts


if __name__ == "__main__":
    texts = load_methodology_pdfs()
    for name, text in texts.items():
        print(f"=== {name} ({len(text):,} caracteres) ===")
        print(text[:500])
        print("...\n")
