"""Convierte los PDFs de metodología a Markdown plano.

Los PDFs nativos viajan a Gemini como documento (visión): cada página cobra
un costo fijo de tokens más el texto, sin importar cuánto contenido real
contenga. El Markdown plano cuesta tokens proporcionales solo al texto, lo
que reduce el input facturable varias veces para documentos con mucho
diseño e imágenes decorativas.

El contenido auditable de ambos manuales (etapas, competencias, buenas
prácticas) vive en el texto, no en las imágenes, por lo que la extracción
de texto preserva lo que el auditor necesita comparar.
"""
from __future__ import annotations
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader

from config import PEDAGOGIA_PDF, BUENAS_PRACTICAS_PDF, ROOT_DIR

MARKDOWN_DIR = ROOT_DIR / "markdown"

# Líneas que se repiten en pie/cabecera de casi todas las páginas y solo
# inflan tokens sin aportar contenido auditable.
BOILERPLATE_PATTERNS = [
    re.compile(r"^Derechos reservados WE Educación Ejecutiva.*INDECOPI$", re.I),
    re.compile(r"^Avalado por:?$", re.I),
]


def _clean_line(line: str) -> str:
    """Normaliza ligaduras tipográficas y colapsa espacios redundantes."""
    line = unicodedata.normalize("NFKC", line)
    return re.sub(r"[ \t]+", " ", line).strip()


def _is_noise(line: str) -> bool:
    return not line or any(p.match(line) for p in BOILERPLATE_PATTERNS)


def _page_to_markdown(page_number: int, raw_text: str) -> str:
    lines = [_clean_line(l) for l in raw_text.splitlines()]
    body = "\n".join(l for l in lines if not _is_noise(l))
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return f"## Página {page_number}\n\n{body}" if body else ""


def pdf_to_markdown(pdf_path: Path, title: str) -> str:
    reader = PdfReader(pdf_path)
    pages = [
        _page_to_markdown(i, page.extract_text() or "")
        for i, page in enumerate(reader.pages, start=1)
    ]
    sections = [p for p in pages if p]
    return f"# {title}\n\n" + "\n\n".join(sections) + "\n"


def convert_all() -> dict[str, Path]:
    """Genera los .md en /markdown y devuelve {clave: ruta}."""
    MARKDOWN_DIR.mkdir(exist_ok=True)
    targets = {
        "pedagogia": (PEDAGOGIA_PDF, "Capacitación Pedagógica WE 2026"),
        "buenas_practicas": (BUENAS_PRACTICAS_PDF, "Manual de Buenas Prácticas 2024"),
    }
    written = {}
    for key, (pdf_path, title) in targets.items():
        md = pdf_to_markdown(pdf_path, title)
        out = MARKDOWN_DIR / f"{pdf_path.stem}.md"
        out.write_text(md, encoding="utf-8")
        written[key] = out
        print(f"{out.name}: {len(md):,} caracteres")
    return written


if __name__ == "__main__":
    convert_all()
