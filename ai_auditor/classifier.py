"""Segmentación temporal y clasificación teoría/práctica con Gemini Flash.

Toma una transcripción con timestamps, la divide en bloques de N segundos
(default 60), y le pide a Gemini Flash que etiquete cada bloque
como TEORIA / PRACTICA / MIXTO / ADMIN.

Una sola llamada por video (batch) — no una por segmento.
"""
from __future__ import annotations
import json
import re
from dataclasses import dataclass, asdict
from typing import Literal

from google import genai
from google.genai import types

from config import (
    GEMINI_API_KEY, GEMINI_CLASSIFIER_MODEL,
    SEGMENT_DURATION_SEC, theory_range,
)
from prompts import CLASSIFIER_INSTRUCTIONS, CLASSIFIER_RESPONSE_SCHEMA
from transcription import TranscriptSegment, _seconds_to_hms


class ClassifierError(RuntimeError):
    """Falla del clasificador Gemini Flash. Distinguible de errores del auditor Pro."""


Label = Literal["TEORIA", "PRACTICA", "MIXTO", "ADMIN"]


@dataclass
class ClassifiedBlock:
    inicio_seg: float
    fin_seg: float
    etiqueta: Label
    razon: str
    transcript_excerpt: str

    @property
    def duracion_seg(self) -> float:
        return self.fin_seg - self.inicio_seg


def chunk_transcript(
    segments: list[TranscriptSegment],
    block_seconds: int = SEGMENT_DURATION_SEC,
) -> list[dict]:
    """Agrupa segmentos del transcript en bloques de N segundos."""
    if not segments:
        return []

    total_end = segments[-1].end
    blocks = []
    cursor = 0
    for block_start in range(0, int(total_end) + 1, block_seconds):
        block_end = block_start + block_seconds
        texts = []
        while cursor < len(segments) and segments[cursor].start < block_end:
            texts.append(segments[cursor].text)
            if segments[cursor].end <= block_end:
                cursor += 1
            else:
                break
        if not texts and cursor >= len(segments):
            break
        blocks.append({
            "inicio_seg": float(block_start),
            "fin_seg": float(min(block_end, total_end)),
            "transcript_excerpt": " ".join(texts).strip(),
        })
    return blocks


# Tamaño del batch para chunking. Gemini 2.5 Flash usa "thinking" interno que
# consume tokens del mismo presupuesto que el output: con 190 bloques en una
# sola llamada, el thinking se comía 31K de 32K tokens y truncaba el JSON.
# Con 30 bloques por batch (≈30 min de video), el output crudo son ~3K tokens
# y queda headroom amplio (~29K) para el thinking. La clasificacion no necesita
# contexto cruzado entre bloques, asi que partir no degrada la calidad.
CLASSIFIER_BATCH_SIZE = 30


def classify_blocks(blocks: list[dict]) -> list[ClassifiedBlock]:
    """Clasifica todos los bloques llamando a Gemini en lotes de CLASSIFIER_BATCH_SIZE.

    Para sesiones largas (≥1h), una sola llamada agota max_output_tokens porque
    el thinking del modelo 2.5 consume tokens del mismo presupuesto. Chunking
    resuelve el limite y ademas permite identificar fallas a nivel de batch.

    Lanza ClassifierError si CUALQUIER batch falla — preferimos abortar entero
    que entregar un ratio incompleto que el auditor Pro use como verdad.
    """
    if not blocks:
        return []

    client = genai.Client(api_key=GEMINI_API_KEY)
    total = len(blocks)
    out: list[ClassifiedBlock] = []
    batch_num = 0
    total_batches = (total + CLASSIFIER_BATCH_SIZE - 1) // CLASSIFIER_BATCH_SIZE

    for start in range(0, total, CLASSIFIER_BATCH_SIZE):
        batch_num += 1
        batch = blocks[start:start + CLASSIFIER_BATCH_SIZE]
        try:
            classified = _classify_one_batch(client, batch, batch_num, total_batches)
        except ClassifierError as e:
            raise ClassifierError(
                f"Batch {batch_num}/{total_batches} ({len(batch)} bloques, "
                f"offset {start}): {e}"
            ) from e
        out.extend(classified)

    return out


def _classify_one_batch(
    client: "genai.Client",
    blocks: list[dict],
    batch_num: int,
    total_batches: int,
) -> list[ClassifiedBlock]:
    """Una sola llamada a Gemini para un batch. Garantiza len(out) == len(blocks)."""
    blocks_text = "\n\n".join(
        f"BLOQUE {i+1} [{_seconds_to_hms(b['inicio_seg'])} - {_seconds_to_hms(b['fin_seg'])}]:\n"
        f"{b['transcript_excerpt'] or '(silencio o sin transcripción)'}"
        for i, b in enumerate(blocks)
    )
    prompt = (
        f"Clasificá estos {len(blocks)} bloques "
        f"(batch {batch_num}/{total_batches}):\n\n{blocks_text}"
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_CLASSIFIER_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=CLASSIFIER_INSTRUCTIONS,
                response_mime_type="application/json",
                response_schema=CLASSIFIER_RESPONSE_SCHEMA,
                # 32000 con batches de 30 bloques: ~3K tokens de output real
                # dejan ~29K para thinking. Headroom amplio.
                max_output_tokens=32000,
                temperature=0,
            ),
        )
    except Exception as e:
        raise ClassifierError(
            f"Gemini {GEMINI_CLASSIFIER_MODEL} no respondió: {type(e).__name__}: {e}"
        ) from e

    finish_reason = _extract_finish_reason(response)
    raw = response.text or ""
    if finish_reason == "MAX_TOKENS":
        raise ClassifierError(
            f"Gemini cortó la respuesta por límite de tokens "
            f"(output={len(raw)} chars). Reducí CLASSIFIER_BATCH_SIZE en classifier.py."
        )

    parsed = _extract_json(raw)
    classified = parsed.get("segmentos") or []
    if not classified:
        raise ClassifierError(
            f"Gemini devolvió 0 segmentos clasificados para {len(blocks)} bloques. "
            f"Respuesta cruda (primeros 500 chars): {raw[:500]!r}"
        )
    if len(classified) < len(blocks):
        print(
            f"[classifier] WARN batch {batch_num}/{total_batches}: "
            f"clasificación parcial {len(classified)}/{len(blocks)} bloques."
        )

    out: list[ClassifiedBlock] = []
    for i, b in enumerate(blocks):
        c = classified[i] if i < len(classified) else {}
        label = (c.get("etiqueta") or "ADMIN").upper()
        if label not in {"TEORIA", "PRACTICA", "MIXTO", "ADMIN"}:
            label = "ADMIN"
        out.append(ClassifiedBlock(
            inicio_seg=b["inicio_seg"],
            fin_seg=b["fin_seg"],
            etiqueta=label,  # type: ignore
            razon=(c.get("razon") or "")[:120],
            transcript_excerpt=b["transcript_excerpt"][:300],
        ))
    return out


def _extract_finish_reason(response) -> str:
    """Devuelve el finish_reason del primer candidato como string ('STOP', 'MAX_TOKENS', ...).

    Espeja la helper de auditor.py para diagnosticar truncamientos por límite
    de tokens de output, que en Gemini 2.5 incluye los thinking tokens internos.
    """
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return "UNKNOWN"
    fr = getattr(candidates[0], "finish_reason", None)
    return getattr(fr, "name", str(fr)) if fr is not None else "UNKNOWN"


def _extract_json(text: str) -> dict:
    """Extrae JSON de la respuesta del LLM, tolerando markdown wrappers.

    Lanza ClassifierError si no se puede parsear; ningún fallback silencioso
    porque el caller necesita saber que la respuesta de Gemini fue invalida.
    """
    text = text.strip()
    if not text:
        raise ClassifierError("Gemini clasificador devolvió respuesta vacía")
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ClassifierError(
            f"No se encontró JSON en la respuesta del clasificador. "
            f"Primeros 300 chars: {text[:300]!r}"
        )
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise ClassifierError(
            f"JSON inválido en respuesta del clasificador: {e}. "
            f"Primeros 300 chars: {text[start:end + 1][:300]!r}"
        ) from e


def compute_ratio(blocks: list[ClassifiedBlock]) -> dict:
    """Calcula porcentaje teoría / práctica excluyendo ADMIN del denominador."""
    teoria = sum(b.duracion_seg for b in blocks if b.etiqueta == "TEORIA")
    practica = sum(b.duracion_seg for b in blocks if b.etiqueta == "PRACTICA")
    mixto = sum(b.duracion_seg for b in blocks if b.etiqueta == "MIXTO")
    admin = sum(b.duracion_seg for b in blocks if b.etiqueta == "ADMIN")

    teoria_efectiva = teoria + mixto / 2
    practica_efectiva = practica + mixto / 2
    util = teoria_efectiva + practica_efectiva
    min_t, max_t = theory_range()
    rango = f"{int(min_t)}%-{int(max_t)}% teórico"

    if util == 0:
        return {
            "porcentaje_teoria": 0.0,
            "porcentaje_practica": 0.0,
            "minutos_teoria": 0.0,
            "minutos_practica": 0.0,
            "minutos_admin": round(admin / 60, 1),
            "cumple_ratio": False,
            "rango_aceptable": rango,
        }

    pct_teoria = teoria_efectiva / util * 100
    pct_practica = practica_efectiva / util * 100

    return {
        "porcentaje_teoria": round(pct_teoria, 1),
        "porcentaje_practica": round(pct_practica, 1),
        "minutos_teoria": round(teoria_efectiva / 60, 1),
        "minutos_practica": round(practica_efectiva / 60, 1),
        "minutos_admin": round(admin / 60, 1),
        "cumple_ratio": min_t <= pct_teoria <= max_t,
        "rango_aceptable": rango,
    }


def render_classification_table(blocks: list[ClassifiedBlock]) -> str:
    """Tabla legible para inyectar en el prompt del auditor."""
    lines = ["| Inicio | Fin | Etiqueta | Razón |", "|---|---|---|---|"]
    for b in blocks:
        lines.append(
            f"| {_seconds_to_hms(b.inicio_seg)} | {_seconds_to_hms(b.fin_seg)} "
            f"| {b.etiqueta} | {b.razon} |"
        )
    return "\n".join(lines)


def serialize_blocks(blocks: list[ClassifiedBlock]) -> list[dict]:
    return [asdict(b) for b in blocks]
