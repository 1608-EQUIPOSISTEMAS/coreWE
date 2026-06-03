"""Auditor pedagógico — llamada principal a Gemini 2.5 Pro.

Pieza central. Combina:
  - Metodología (pedagogía como Markdown + manual como PDF nativo) con caching
  - Imagen del syllabus (vision)
  - Transcripción + clasificación pre-calculada teoría/práctica
  - Métricas deterministas (cobertura de temas, ratio tiempo)
  → Devuelve un reporte JSON estructurado vía response_schema.

Optimizaciones de tokens (vs versión anterior):
  • response_schema en lugar de schema inline en el prompt: ahorra ~1.2K input.
  • Pedagogía como Markdown: ~5x menos tokens que el PDF nativo (documento de
    mucho diseño y poco texto, donde 258 tok/página no rentaba).
  • Manual como PDF nativo: denso en texto, la tarifa plana por página es más
    eficiente y conserva fidelidad de tablas/diagramas.
  • Thinking acotado (thinking_budget): el razonamiento del modelo 2.5 se
    factura a precio de output; sin tope era el grueso del costo.
  • Metodología al frente de contents: el caching implícito la descuenta cuando
    varias auditorías ocurren seguidas, sin gestionar cachedContents.
"""
from __future__ import annotations
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from google import genai
from google.genai import types

from config import (
    GEMINI_API_KEY, GEMINI_MODEL, AUDITOR_THINKING_BUDGET,
    PEDAGOGIA_MD, BUENAS_PRACTICAS_PDF, CACHE_DIR,
)
from prompts import (
    RESPONSE_SCHEMA, build_user_text, get_auditor_system_instruction,
)
from transcription import TranscriptSegment, segments_to_text, total_duration_min
from classifier import ClassifiedBlock, render_classification_table, compute_ratio
from retry import with_retry


LAST_BAD_RESPONSE = CACHE_DIR / "last_bad_response.txt"

# No se gestiona caché explícita (cachedContents). A volumen esporádico el TTL
# expira sin reusarse y la creación + almacenamiento por hora resultan más
# caros que el envío inline. La metodología va al inicio de contents para que
# el caching IMPLÍCITO de Gemini 2.5 la descuente automáticamente cuando varias
# auditorías ocurren seguidas, sin TTL ni estado en disco que mantener.
# Si el volumen creciera mucho, reconsiderar caché explícita aquí.


def _methodology_parts() -> list[types.Part]:
    """Bloques de metodología: pedagogía como texto Markdown, manual como PDF."""
    return [
        types.Part.from_text(text=PEDAGOGIA_MD.read_text(encoding="utf-8")),
        types.Part.from_bytes(
            data=BUENAS_PRACTICAS_PDF.read_bytes(), mime_type="application/pdf",
        ),
    ]


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
    thinking_tokens: int = 0

    def cost_estimate_usd(self) -> float:
        """Tarifas Gemini 2.5 Pro (Nov 2025), prompts < 200K tokens.
          input:  $1.25 / 1M
          output: $10.00 / 1M  (incluye thinking tokens)
          cached: $0.31 / 1M  (~75% off)

        candidates_token_count NO incluye los thinking tokens, que se facturan
        aparte a precio de output: por eso se suman explícitamente.
        """
        per_mtok_input = 1.25
        per_mtok_output = 10.00
        per_mtok_cached = 0.3125
        fresh_input = max(self.input_tokens - self.cached_tokens, 0)
        billable_output = self.output_tokens + self.thinking_tokens
        return (
            fresh_input * per_mtok_input
            + self.cached_tokens * per_mtok_cached
            + billable_output * per_mtok_output
        ) / 1_000_000


def _read_image_part(path: Path) -> types.Part:
    suffix = path.suffix.lower().lstrip(".")
    mime_type = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "webp": "image/webp", "gif": "image/gif",
    }.get(suffix, "image/png")
    return types.Part.from_bytes(data=path.read_bytes(), mime_type=mime_type)


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
    # Metodología al frente (prefijo estable) → image + user_text variables al
    # final. Así el caching implícito de Gemini descuenta el prefijo repetido.
    contents = [*_methodology_parts(), image_part, user_text]

    # max_output_tokens cubre thinking + visible. Con el thinking acotado a
    # AUDITOR_THINKING_BUDGET y el reporte visible en ~3.5K, 12K deja headroom
    # holgado sin truncar.
    # thinking_config acota el razonamiento interno del modelo 2.5, que se
    # factura a precio de output: sin tope gastaba ~19K tokens/auditoría (el
    # grueso del costo). El SDK >=1.10 acepta thinking_budget.
    # temperature=0 fuerza greedy decoding: el modelo elige siempre el token
    # mas probable. Garantiza que dos corridas con el mismo transcript +
    # syllabus den scores reproducibles, condicion necesaria para persistir
    # el reporte en BD y consultarlo como verdad unica.
    common_config = dict(
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=12000,
        temperature=0,
        thinking_config=types.ThinkingConfig(thinking_budget=AUDITOR_THINKING_BUDGET),
    )

    config = types.GenerateContentConfig(
        system_instruction=get_auditor_system_instruction(),
        **common_config,
    )

    response = with_retry(lambda: client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=config,
    ))

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
        thinking_tokens=getattr(usage, "thoughts_token_count", 0) or 0,
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
