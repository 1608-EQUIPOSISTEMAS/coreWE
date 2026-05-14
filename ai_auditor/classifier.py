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


def classify_blocks(blocks: list[dict]) -> list[ClassifiedBlock]:
    """Llama a Gemini UNA vez con todos los bloques. Devuelve clasificación."""
    if not blocks:
        return []

    client = genai.Client(api_key=GEMINI_API_KEY)
    blocks_text = "\n\n".join(
        f"BLOQUE {i+1} [{_seconds_to_hms(b['inicio_seg'])} - {_seconds_to_hms(b['fin_seg'])}]:\n"
        f"{b['transcript_excerpt'] or '(silencio o sin transcripción)'}"
        for i, b in enumerate(blocks)
    )

    prompt = f"Clasificá estos {len(blocks)} bloques:\n\n{blocks_text}"

    response = client.models.generate_content(
        model=GEMINI_CLASSIFIER_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=CLASSIFIER_INSTRUCTIONS,
            response_mime_type="application/json",
            response_schema=CLASSIFIER_RESPONSE_SCHEMA,
            max_output_tokens=8000,
            temperature=0,
        ),
    )

    parsed = _extract_json(response.text or "")
    classified = parsed.get("segmentos", [])

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


def _extract_json(text: str) -> dict:
    """Extrae JSON de la respuesta del LLM, tolerando markdown wrappers."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return {"segmentos": []}
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {"segmentos": []}


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
