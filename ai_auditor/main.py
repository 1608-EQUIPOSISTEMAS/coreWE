"""API FastAPI que orquesta la auditoría completa.

Endpoints:
  POST /audit               → corre la auditoría (recibe transcript + imagen + sesión)
  POST /audit/from-video    → modo Whisper (recibe video, transcribe, audita)
  GET  /reports             → lista reportes pasados
  GET  /reports/{filename}  → recupera un reporte
  GET  /                    → sirve el frontend
"""
from __future__ import annotations
import json
import logging
import traceback
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from config import (
    UPLOADS_DIR, REPORTS_DIR, ROOT_DIR, assert_ready,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger("ai_auditor")
from transcription import (
    parse_manual_transcript, transcribe_with_whisper, total_duration_min,
)
from classifier import chunk_transcript, classify_blocks, serialize_blocks
from auditor import AuditInput, audit, save_report


app = FastAPI(title="System Auditor — WE Educacion Ejecutiva")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    assert_ready()


# Handler global: en vez de devolver "Internal Server Error" generico, expone
# el traceback completo al cliente para diagnostico. Asume entorno de dev/staging;
# en produccion ajustar para no leak stack traces.
@app.exception_handler(Exception)
async def universal_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    log.error("Excepcion no manejada en %s: %s\n%s", request.url.path, exc, tb)
    return JSONResponse(
        status_code=500,
        content={
            "error": exc.__class__.__name__,
            "message": str(exc),
            "traceback": tb.splitlines()[-20:],  # ultimas 20 lineas
        },
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/audit")
async def audit_endpoint(
    sesion_numero: int = Form(...),
    transcript_text: str = Form(...),
    syllabus_image: UploadFile = File(...),
) -> JSONResponse:
    """Ruta principal: transcript pegado/subido + imagen del syllabus."""
    if not transcript_text.strip():
        raise HTTPException(400, "transcript_text vacío")

    image_path = _save_upload(syllabus_image, prefix=f"syllabus_s{sesion_numero}")

    segments = parse_manual_transcript(transcript_text)
    if not segments:
        raise HTTPException(
            400,
            "No se pudieron extraer segmentos del transcript. "
            "Asegúrate de que tenga timestamps tipo [00:01:23] al inicio de cada línea.",
        )

    blocks = chunk_transcript(segments)
    classified = classify_blocks(blocks)

    result = audit(AuditInput(
        sesion_numero=sesion_numero,
        transcript=segments,
        classified_blocks=classified,
        syllabus_image_path=image_path,
    ))

    report_path = save_report(
        result.report, REPORTS_DIR,
        basename=f"sesion{sesion_numero}_{syllabus_image.filename or 'audit'}",
    )

    return JSONResponse({
        "report": result.report,
        "metadata": {
            "report_file": report_path.name,
            "duration_min": round(total_duration_min(segments), 1),
            "segments_classified": len(classified),
            "tokens": {
                "input": result.input_tokens,
                "output": result.output_tokens,
                "cached": result.cached_tokens,
            },
            "estimated_cost_usd": round(result.cost_estimate_usd(), 4),
            "classification_preview": serialize_blocks(classified[:5]),
        },
    })


@app.post("/api/audit/from-video")
async def audit_from_video(
    sesion_numero: int = Form(...),
    video: UploadFile = File(...),
    syllabus_image: UploadFile = File(...),
) -> JSONResponse:
    """Modo Whisper. Requiere faster-whisper instalado."""
    video_path = _save_upload(video, prefix=f"video_s{sesion_numero}")
    image_path = _save_upload(syllabus_image, prefix=f"syllabus_s{sesion_numero}")

    try:
        segments = transcribe_with_whisper(video_path)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    if not segments:
        raise HTTPException(422, "Whisper no encontró audio transcribible en el video.")

    blocks = chunk_transcript(segments)
    classified = classify_blocks(blocks)

    result = audit(AuditInput(
        sesion_numero=sesion_numero,
        transcript=segments,
        classified_blocks=classified,
        syllabus_image_path=image_path,
    ))

    report_path = save_report(
        result.report, REPORTS_DIR,
        basename=f"sesion{sesion_numero}_video_{video.filename or 'audit'}",
    )

    return JSONResponse({
        "report": result.report,
        "metadata": {
            "report_file": report_path.name,
            "duration_min": round(total_duration_min(segments), 1),
            "segments_classified": len(classified),
            "tokens": {
                "input": result.input_tokens,
                "output": result.output_tokens,
                "cached": result.cached_tokens,
            },
            "estimated_cost_usd": round(result.cost_estimate_usd(), 4),
        },
    })


@app.get("/api/reports")
def list_reports() -> dict:
    reports = sorted(
        [p.name for p in REPORTS_DIR.glob("*.json")],
        reverse=True,
    )
    return {"reports": reports}


@app.get("/api/reports/{filename}")
def get_report(filename: str) -> JSONResponse:
    path = REPORTS_DIR / filename
    if not path.exists() or path.suffix != ".json":
        raise HTTPException(404, "Reporte no encontrado")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


def _save_upload(upload: UploadFile, prefix: str) -> Path:
    suffix = Path(upload.filename or "").suffix or ".bin"
    out = UPLOADS_DIR / f"{prefix}{suffix}"
    out.write_bytes(upload.file.read())
    return out


