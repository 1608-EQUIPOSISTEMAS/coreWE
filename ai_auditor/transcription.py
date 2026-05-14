"""Transcripción de videos a texto con timestamps.

Soporta 2 modos:

  1) MODO MANUAL — el auditor sube un .txt/.vtt con el transcript ya generado
     por Zoom/Teams/YouTube. Es el modo recomendado para el MVP porque no
     depende de Whisper local.

  2) MODO AUTOMÁTICO — si faster-whisper está instalado, transcribe el video
     directamente. Útil cuando el video no tiene transcript previo.

Salida normalizada en ambos casos:
  list[Segment] donde cada Segment tiene .start (s), .end (s), .text.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class TranscriptSegment:
    start: float  # segundos desde el inicio del video
    end: float
    text: str

    def fmt_timestamp(self) -> str:
        return _seconds_to_hms(self.start)


# Pattern que reconoce [HH:MM:SS], [MM:SS], [HH:MM:SS.mmm], (00:01:23), etc.
TIMESTAMP_RE = re.compile(
    r"[\[\(]?\s*"
    r"(?:(\d{1,2}):)?"        # horas (opcional)
    r"(\d{1,2}):"              # minutos
    r"(\d{1,2})"               # segundos
    r"(?:[.,](\d{1,3}))?"      # milisegundos (opcional)
    r"\s*[\]\)]?"
)


def _seconds_to_hms(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = int(s % 60)
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def _parse_timestamp(match: re.Match) -> float:
    h, m, sec, ms = match.groups()
    total = (int(h) if h else 0) * 3600 + int(m) * 60 + int(sec)
    if ms:
        total += int(ms.ljust(3, "0")) / 1000
    return float(total)


def parse_manual_transcript(text: str) -> list[TranscriptSegment]:
    """Parsea un transcript pegado en texto plano.

    Soporta formatos comunes:
      [00:01:23] Texto del segmento.
      00:01:23 Texto del segmento.
      WEBVTT (Zoom/Teams VTT con timestamps en líneas separadas).
    """
    text = text.strip()
    if not text:
        return []

    if text.upper().startswith("WEBVTT"):
        return _parse_vtt(text)

    return _parse_inline(text)


def _parse_inline(text: str) -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    last_start: float | None = None
    buffer: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = TIMESTAMP_RE.match(line)
        if m and (m.group(1) or m.group(2)):
            if last_start is not None:
                segments.append(
                    TranscriptSegment(last_start, last_start, " ".join(buffer).strip())
                )
            last_start = _parse_timestamp(m)
            buffer = [line[m.end():].strip()]
        else:
            buffer.append(line)

    if last_start is not None and buffer:
        segments.append(TranscriptSegment(last_start, last_start, " ".join(buffer).strip()))

    for i, seg in enumerate(segments[:-1]):
        seg.end = segments[i + 1].start
    if segments:
        segments[-1].end = segments[-1].start + 5.0

    return [s for s in segments if s.text]


def _parse_vtt(text: str) -> list[TranscriptSegment]:
    """Parser mínimo de WebVTT (formato Zoom/Teams)."""
    segments: list[TranscriptSegment] = []
    blocks = re.split(r"\n\n+", text)
    range_re = re.compile(
        r"(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})"
    )

    def to_secs(t: str) -> float:
        h, m, rest = t.split(":")
        s, ms = re.split(r"[.,]", rest)
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    for block in blocks:
        rm = range_re.search(block)
        if not rm:
            continue
        text_lines = []
        for ln in block.splitlines():
            if range_re.search(ln) or ln.strip().isdigit() or ln.strip().upper() == "WEBVTT":
                continue
            if ln.strip():
                text_lines.append(ln.strip())
        if text_lines:
            segments.append(
                TranscriptSegment(
                    start=to_secs(rm.group(1)),
                    end=to_secs(rm.group(2)),
                    text=" ".join(text_lines),
                )
            )
    return segments


def transcribe_with_whisper(video_path: Path) -> list[TranscriptSegment]:
    """Modo automático. Lazy-import para no romper si Whisper no está instalado."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError(
            "faster-whisper no está instalado. Instala con: "
            "pip install faster-whisper imageio-ffmpeg"
        ) from e

    from config import WHISPER_MODEL_SIZE, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE

    model = WhisperModel(
        WHISPER_MODEL_SIZE,
        device=WHISPER_DEVICE,
        compute_type=WHISPER_COMPUTE_TYPE,
    )
    segments_iter, _info = model.transcribe(
        str(video_path),
        language="es",
        vad_filter=True,
        beam_size=5,
    )
    return [
        TranscriptSegment(start=s.start, end=s.end, text=s.text.strip())
        for s in segments_iter
    ]


def segments_to_text(segments: list[TranscriptSegment]) -> str:
    """Renderiza segmentos como texto con timestamp legible para el LLM."""
    return "\n".join(
        f"[{seg.fmt_timestamp()}] {seg.text}" for seg in segments
    )


def total_duration_min(segments: list[TranscriptSegment]) -> float:
    if not segments:
        return 0.0
    return segments[-1].end / 60.0
