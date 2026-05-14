"""Auditor pedagógico — llamada principal a Gemini 2.5 Pro.

Pieza central. Combina:
  - PDFs de metodología (Part nativo + context caching)
  - Imagen del syllabus (vision)
  - Transcripción + clasificación pre-calculada teoría/práctica
  - Métricas deterministas (cobertura de temas, ratio tiempo)
  → Devuelve un reporte JSON estructurado vía response_schema.

Optimizaciones de tokens (vs versión anterior):
  • response_schema en lugar de schema inline en el prompt: ahorra ~1.2K input.
  • PDFs como Part nativo: fija el bug de pypdf perdiendo contenido escaneado.
  • Context caching de los 2 PDFs: ~75% off en input cacheado en steady state.
"""
from __future__ import annotations
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from google import genai
from google.genai import types

from config import (
    GEMINI_API_KEY, GEMINI_MODEL,
    PEDAGOGIA_PDF, BUENAS_PRACTICAS_PDF, CACHE_DIR,
)
from prompts import (
    RESPONSE_SCHEMA, build_user_text, get_auditor_system_instruction,
)
from transcription import TranscriptSegment, segments_to_text, total_duration_min
from classifier import ClassifiedBlock, render_classification_table, compute_ratio


CACHE_META_FILE = CACHE_DIR / "gemini_cache.json"
CACHE_TTL_SECONDS = 3600
LAST_BAD_RESPONSE = CACHE_DIR / "last_bad_response.txt"


@dataclass
class AuditInput:
    sesion_numero: int
    transcript: list[TranscriptSegment]
    classified_blocks: list[ClassifiedBlock]
    syllabus_image_path: Path


@dataclass
class AuditResult:
    report: dict
    input_tokens: int
    output_tokens: int
    cached_tokens: int

    def cost_estimate_usd(self) -> float:
        """Tarifas Gemini 2.5 Pro (Nov 2025), prompts < 200K tokens.
          input:  $1.25 / 1M
          output: $10.00 / 1M
          cached: $0.31 / 1M  (~75% off)
        """
        per_mtok_input = 1.25
        per_mtok_output = 10.00
        per_mtok_cached = 0.3125
        fresh_input = max(self.input_tokens - self.cached_tokens, 0)
        return (
            fresh_input * per_mtok_input
            + self.cached_tokens * per_mtok_cached
            + self.output_tokens * per_mtok_output
        ) / 1_000_000


def _read_image_part(path: Path) -> types.Part:
    suffix = path.suffix.lower().lstrip(".")
    mime_type = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "webp": "image/webp", "gif": "image/gif",
    }.get(suffix, "image/png")
    return types.Part.from_bytes(data=path.read_bytes(), mime_type=mime_type)


def _get_or_create_pdf_cache(client: genai.Client) -> str | None:
    """Sube los 2 PDFs como contexto cacheado para reusarlo entre auditorías.

    Devuelve el resource name del cache (`cachedContents/...`), o None si la
    creación falla — en ese caso el caller manda los PDFs inline cada vez
    (más caro, pero el sistema no se rompe).

    Cacheamos en disco el resource name + expira_at para reusar entre runs.
    """
    if CACHE_META_FILE.exists():
        meta = json.loads(CACHE_META_FILE.read_text(encoding="utf-8"))
        if meta.get("expires_at", 0) > time.time() + 60:
            return meta["name"]

    pedagogia_part = types.Part.from_bytes(
        data=PEDAGOGIA_PDF.read_bytes(), mime_type="application/pdf",
    )
    buenas_part = types.Part.from_bytes(
        data=BUENAS_PRACTICAS_PDF.read_bytes(), mime_type="application/pdf",
    )

    try:
        cached = client.caches.create(
            model=GEMINI_MODEL,
            config=types.CreateCachedContentConfig(
                system_instruction=get_auditor_system_instruction(),
                contents=[pedagogia_part, buenas_part],
                ttl=f"{CACHE_TTL_SECONDS}s",
            ),
        )
    except Exception as e:
        # Cuentas free tier o modelos sin caching pueden fallar acá.
        # Loguea para debug pero no rompas la auditoría.
        print(f"[auditor] caching no disponible ({type(e).__name__}: {e}); "
              f"se usará envío inline.")
        return None

    CACHE_META_FILE.write_text(json.dumps({
        "name": cached.name,
        "expires_at": time.time() + CACHE_TTL_SECONDS,
        "model": GEMINI_MODEL,
    }), encoding="utf-8")
    return cached.name


def _format_deterministic_metrics(audit_input: AuditInput, ratio: dict) -> str:
    """Texto plano con métricas pre-calculadas, listo para inyectar al prompt."""
    duracion = round(total_duration_min(audit_input.transcript), 1)
    return (
        f"  duracion_total_min: {duracion}\n"
        f"  porcentaje_teoria: {ratio.get('porcentaje_teoria', 0)}%\n"
        f"  porcentaje_practica: {ratio.get('porcentaje_practica', 0)}%\n"
        f"  minutos_teoria: {ratio.get('minutos_teoria', 0)}\n"
        f"  minutos_practica: {ratio.get('minutos_practica', 0)}\n"
        f"  rango_aceptable_teoria: {ratio.get('rango_aceptable', '')}\n"
        f"  cumple_ratio: {ratio.get('cumple_ratio', False)}"
    )


def audit(audit_input: AuditInput) -> AuditResult:
    """Ejecuta la auditoría con Gemini 2.5 Pro + structured outputs."""
    client = genai.Client(api_key=GEMINI_API_KEY)

    transcript_text = segments_to_text(audit_input.transcript)
    classification_table = render_classification_table(audit_input.classified_blocks)
    ratio = compute_ratio(audit_input.classified_blocks)
    metricas_text = _format_deterministic_metrics(audit_input, ratio)

    user_text = build_user_text(
        sesion_numero=audit_input.sesion_numero,
        transcript_text=transcript_text,
        segment_classification=classification_table,
        metricas_deterministas=metricas_text,
    )

    image_part = _read_image_part(audit_input.syllabus_image_path)
    contents = [image_part, user_text]

    # max_output_tokens cubre thinking + visible. El reporte completo son ~3K
    # output tokens; con Gemini 2.5 Pro necesitamos headroom amplio.
    # Nota: thinking_config se removio porque la API del SDK google-genai
    # cambio entre versiones (el nombre del parametro `thinking_budget` ya
    # no es aceptado en >=1.3.0). El modelo usa su default de thinking budget,
    # cuesta marginalmente mas pero funciona sin tocar la version del SDK.
    # temperature=0 fuerza greedy decoding: el modelo elige siempre el token
    # mas probable. Garantiza que dos corridas con el mismo transcript +
    # syllabus den scores reproducibles, condicion necesaria para persistir
    # el reporte en BD y consultarlo como verdad unica.
    common_config = dict(
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=32000,
        temperature=0,
    )

    cache_name = _get_or_create_pdf_cache(client)
    if cache_name:
        config = types.GenerateContentConfig(cached_content=cache_name, **common_config)
    else:
        pedagogia_part = types.Part.from_bytes(
            data=PEDAGOGIA_PDF.read_bytes(), mime_type="application/pdf",
        )
        buenas_part = types.Part.from_bytes(
            data=BUENAS_PRACTICAS_PDF.read_bytes(), mime_type="application/pdf",
        )
        contents = [pedagogia_part, buenas_part, image_part, user_text]
        config = types.GenerateContentConfig(
            system_instruction=get_auditor_system_instruction(),
            **common_config,
        )

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=config,
    )

    raw = response.text or ""
    finish_reason = _extract_finish_reason(response)
    if finish_reason == "MAX_TOKENS":
        LAST_BAD_RESPONSE.write_text(raw, encoding="utf-8")
        raise RuntimeError(
            "Gemini cortó la respuesta por límite de tokens (finish_reason=MAX_TOKENS). "
            f"Respuesta parcial guardada en {LAST_BAD_RESPONSE} ({len(raw)} chars). "
            "Subí max_output_tokens en auditor.py o reducí el thinking_budget."
        )

    try:
        report = _parse_report_json(raw)
    except (ValueError, json.JSONDecodeError) as e:
        LAST_BAD_RESPONSE.write_text(raw, encoding="utf-8")
        raise RuntimeError(
            f"Gemini devolvió contenido no parseable como JSON ({e}). "
            f"finish_reason={finish_reason}. "
            f"Respuesta cruda en {LAST_BAD_RESPONSE} ({len(raw)} chars). "
            f"Primeros 500 chars: {raw[:500]!r}"
        ) from e
    report = _enrich_report(report, audit_input, ratio)

    usage = response.usage_metadata
    return AuditResult(
        report=report,
        input_tokens=getattr(usage, "prompt_token_count", 0) or 0,
        output_tokens=getattr(usage, "candidates_token_count", 0) or 0,
        cached_tokens=getattr(usage, "cached_content_token_count", 0) or 0,
    )


def _extract_finish_reason(response) -> str:
    """Devuelve el finish_reason del primer candidato como string ('STOP', 'MAX_TOKENS', ...)."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return "UNKNOWN"
    fr = getattr(candidates[0], "finish_reason", None)
    return getattr(fr, "name", str(fr)) if fr is not None else "UNKNOWN"


def _parse_report_json(raw: str) -> dict:
    """Con response_schema Gemini garantiza JSON válido — esto es defensivo."""
    raw = raw.strip()
    if not raw:
        raise ValueError("El auditor devolvió respuesta vacía")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        fence = re.search(r"```(?:json)?\s*(.*?)```", raw, re.DOTALL)
        if fence:
            return json.loads(fence.group(1))
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end == -1:
            raise ValueError(f"No se encontró JSON en la respuesta:\n{raw[:500]}")
        return json.loads(raw[start:end + 1])


def _enrich_report(report: dict, audit_input: AuditInput, ratio: dict) -> dict:
    """Agrega metadatos calculados deterministamente."""
    duracion = round(total_duration_min(audit_input.transcript), 1)

    sesion = report.setdefault("sesion_evaluada", {})
    sesion["numero"] = audit_input.sesion_numero
    sesion["duracion_total_min"] = duracion
    sesion["fecha_auditoria"] = datetime.now(timezone.utc).isoformat()

    metricas = report.setdefault("metricas_rapidas", {})
    metricas["porcentaje_teoria"] = ratio.get("porcentaje_teoria", 0.0)
    metricas["porcentaje_practica"] = ratio.get("porcentaje_practica", 0.0)
    return report


def save_report(report: dict, reports_dir: Path, basename: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", basename)
    out = reports_dir / f"{timestamp}_{safe}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
