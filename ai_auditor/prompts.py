"""Prompts del auditor pedagógico WE.

Las instrucciones se construyen a partir de los manuales oficiales:
  - Aprende a ser un docente WE - Pedagogía 2026
  - MANUAL BUENAS PRÁCTICAS DOCENTE 2024

Si el área de calidad cambia los criterios, edita AUDITOR_INSTRUCTIONS,
RESPONSE_SCHEMA o el archivo rubrica.py — no toques las funciones de
plumbing al final.

Diseño:
  • Los manuales viajan como Part nativo (PDF) en system_instruction —
    ver auditor.py. Acá solo va la rúbrica + instrucciones evaluativas.
  • El schema viaja por response_schema (no inline en el prompt). Esto
    ahorra ~1.2K tokens por auditoría y garantiza la forma de salida.
"""
from __future__ import annotations

from config import THEORY_TARGET_PCT, THEORY_TOLERANCE_PCT, theory_range
from rubrica import render_rubric_for_prompt, CRITERIOS


AUDITOR_INSTRUCTIONS = """\
Eres un auditor pedagógico senior de WE Educación Ejecutiva. Evalúas, con \
evidencia citada del transcript, si una sesión grabada cumple con la \
metodología WE descrita en los 2 manuales adjuntos.

═══════════════════════════════════════════════════════════════════════════
QUÉ EVALÚAS — 9 criterios, cada uno con score 1-5
═══════════════════════════════════════════════════════════════════════════

Aplicá esta rúbrica para cada criterio. El 5/3/1 son anchors; el 4 y el 2
son interpolación. Si un criterio no se puede evaluar por falta de evidencia
(p.ej. el video no muestra pantalla compartida), pone score=null y explicá
en `comentario`.

{rubrica_render}

═══════════════════════════════════════════════════════════════════════════
MÉTRICAS DETERMINISTAS — no las recalcules
═══════════════════════════════════════════════════════════════════════════

El sistema te pasa pre-calculado:
  • porcentaje_teoria / porcentaje_practica (rango aceptable: {min_teoria}%-{max_teoria}% teórico)
  • temas_cubiertos / temas_totales del syllabus
  • duracion_total_min

NO los recalcules. Citalos en `metricas_rapidas` tal cual los recibís y
úsalos como insumo para los criterios (especialmente "Calidad de talleres" y
"Gestión del tiempo").

═══════════════════════════════════════════════════════════════════════════
CÓMO EVALÚAS
═══════════════════════════════════════════════════════════════════════════

• EVIDENCIA SIEMPRE: cada criterio cita ≥1 timestamp del transcript ([HH:MM:SS]).
• NO INVENTES: si no hay evidencia, score=null y explicá por qué.
• TONO: profesional, directo, basado en evidencia. Tu lector es el área de
  calidad de WE.
• FORTALEZAS top-3: ordenadas por impacto pedagógico (lo más alto primero).
  Título imperativo ≤8 palabras + detalle de 1 oración ≤18 palabras.
• OPORTUNIDADES top-5: ordenadas por urgencia (lo crítico primero).
  Mismo formato: ≤8 palabras título, ≤18 palabras detalle, una sola oración.
• MANTENER vs CAMBIAR: 5 prácticas que el docente debe sostener vs 5 cosas
  estructurales que hay que cambiar urgente. No dupliques con
  fortalezas/oportunidades — esto es accionable, condensado.
• QUICK WINS vs MEJORAS ESTRATÉGICAS: 3 acciones implementables esta semana
  vs 3 que requieren rediseño de sesión. Una oración por ítem, ≤18 palabras.

═══════════════════════════════════════════════════════════════════════════
ESTILO DE PUNTOS — fortalezas, oportunidades, quick wins, mejoras
═══════════════════════════════════════════════════════════════════════════

# TODO(WE): definir el tono de los puntos. Reemplazar este bloque con 4-6
# bullets que describan cómo debe sonar un punto bien escrito para WE.
# Pensá en: ¿verbo de qué tipo? ¿se permite jerga pedagógica?
# ¿se cita evidencia adentro del bullet o queda solo en el criterio?
# ¿ejemplo de un punto MAL escrito vs uno BIEN escrito?

• PUNTUACIÓN GLOBAL: promedio simple de los 9 scores con 1 decimal.
  Veredicto:
    • EXCELENTE: ≥ 4.3
    • SÓLIDO:    3.6 – 4.2
    • OBSERVADO: 2.6 – 3.5
    • CRÍTICO:   ≤ 2.5
• VEREDICTO en prosa: 3-4 párrafos en `veredicto.cuerpo`. Primer párrafo:
  qué funciona muy bien. Siguientes: los 2-3 problemas estructurales más
  importantes. Cierre: cuánto puede crecer este score con ajustes.
"""


def _format_instructions() -> str:
    min_t, max_t = theory_range()
    return AUDITOR_INSTRUCTIONS.format(
        rubrica_render=render_rubric_for_prompt(),
        min_teoria=int(min_t),
        max_teoria=int(max_t),
    )


# ── JSON Schema (Gemini structured outputs) ───────────────────────────────
# Importante: Gemini sigue OpenAPI 3.0 schema-ish. Soporta type, properties,
# required, enum, items, description, nullable. NO soporta oneOf/anyOf
# complejos. Mantenelo plano.

_CRITERIO_ITEM = {
    "type": "object",
    "properties": {
        "id":         {"type": "integer", "description": "1 a 9 según rúbrica"},
        "nombre":     {"type": "string"},
        "score":      {"type": "integer",
                       "description": "1 a 5. Si no hay evidencia para evaluar, asigna 1 y "
                                      "explicá la falta de evidencia en `comentario`."},
        "comentario": {"type": "string",
                       "description": "2-3 oraciones: qué se observó + por qué este score."},
        "evidencia_timestamps": {
            "type": "array", "items": {"type": "string"},
            "description": "Timestamps citados del transcript, formato [HH:MM:SS] o [MM:SS].",
        },
    },
    "required": ["id", "nombre", "score", "comentario"],
}

_KEEP_CHANGE_ITEM = {
    "type": "object",
    "properties": {
        "titulo": {"type": "string",
                   "description": "Imperativo, máximo 8 palabras. Sin relleno ('debería', 'sería bueno')."},
        "detalle": {"type": "string",
                    "description": "UNA oración, máximo 18 palabras. El 'por qué' con evidencia, no parafrasear el título."},
    },
    "required": ["titulo"],
}

_RECOMENDACION_ITEM = {
    "type": "object",
    "properties": {
        "titulo": {"type": "string",
                   "description": "Acción concreta en imperativo, máximo 8 palabras."},
        "detalle": {"type": "string",
                    "description": "UNA oración, máximo 18 palabras. Cómo aplicarlo, no por qué importa."},
    },
    "required": ["titulo", "detalle"],
}


RESPONSE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "criterios": {
            "type": "array",
            "description": "Los 9 criterios en orden, con score 1-5.",
            "items": _CRITERIO_ITEM,
        },
        "metricas_rapidas": {
            "type": "object",
            "properties": {
                "puntuacion_global":    {"type": "number", "description": "Promedio simple de los 9 scores. 1 decimal."},
                "temas_cubiertos":      {"type": "integer"},
                "temas_totales":        {"type": "integer"},
                "porcentaje_practica":  {"type": "number", "description": "% del tiempo en talleres/práctica."},
                "porcentaje_teoria":    {"type": "number", "description": "% del tiempo en teoría/exposición."},
                "balance_metodologico": {"type": "string",
                    "description": "Una etiqueta corta: 'Saludable', 'Aceptable', 'Desbalance crítico'."},
            },
            "required": ["puntuacion_global", "temas_cubiertos", "temas_totales",
                         "porcentaje_practica", "porcentaje_teoria", "balance_metodologico"],
        },
        "fortalezas_top3": {
            "type": "array", "items": _KEEP_CHANGE_ITEM,
            "description": "Top 3 ordenadas por impacto pedagógico.",
        },
        "oportunidades_top5": {
            "type": "array", "items": _KEEP_CHANGE_ITEM,
            "description": "Top 5 ordenadas por urgencia.",
        },
        "mantener": {
            "type": "array", "items": _KEEP_CHANGE_ITEM,
            "description": "5 prácticas que el docente debe sostener.",
        },
        "cambiar": {
            "type": "array", "items": _KEEP_CHANGE_ITEM,
            "description": "5 cambios estructurales urgentes.",
        },
        "quick_wins": {
            "type": "array", "items": _RECOMENDACION_ITEM,
            "description": "3 acciones implementables esta semana.",
        },
        "mejoras_estrategicas": {
            "type": "array", "items": _RECOMENDACION_ITEM,
            "description": "3 cambios que requieren rediseño de sesión.",
        },
        "veredicto": {
            "type": "object",
            "properties": {
                "etiqueta": {"type": "string",
                    "description": "EXCELENTE | SOLIDO | OBSERVADO | CRITICO"},
                "titular":  {"type": "string",
                    "description": "Una línea: '3.2/5 — Sesión funcional con optimización urgente necesaria'."},
                "cuerpo":   {"type": "string",
                    "description": "3-4 párrafos en prosa. Markdown sutil permitido (**bold** inline)."},
                "potencial_score": {"type": "number",
                    "description": "Score que esta sesión podría alcanzar con los ajustes propuestos. 1 decimal."},
            },
            "required": ["etiqueta", "titular", "cuerpo"],
        },
    },
    "required": ["criterios", "metricas_rapidas", "fortalezas_top3",
                 "oportunidades_top5", "mantener", "cambiar",
                 "quick_wins", "mejoras_estrategicas", "veredicto"],
}


def build_user_text(
    sesion_numero: int,
    transcript_text: str,
    segment_classification: str,
    metricas_deterministas: str,
) -> str:
    """Mensaje del usuario para Gemini (acompaña la imagen del syllabus).

    El schema NO se incluye acá — viaja por response_schema en el config.
    """
    criterios_lista = "\n".join(
        f"  {c['id']}. {c['nombre']}" for c in CRITERIOS
    )
    return (
        f"La imagen adjunta es el syllabus oficial de la SESIÓN {sesion_numero}. "
        "Cada tema y taller listado debe estar cubierto en el video.\n\n"
        "=== MÉTRICAS DETERMINISTAS (úsalas, no las recalcules) ===\n"
        f"{metricas_deterministas}\n\n"
        "=== TRANSCRIPCIÓN DEL VIDEO (con timestamps) ===\n"
        f"{transcript_text}\n\n"
        "=== CLASIFICACIÓN PRE-PROCESADA DE SEGMENTOS DE 60s ===\n"
        f"{segment_classification}\n\n"
        "=== CRITERIOS A EVALUAR (en este orden, score 1-5 cada uno) ===\n"
        f"{criterios_lista}\n\n"
        f"Generá el reporte completo de auditoría para la SESIÓN {sesion_numero}. "
        "Estructura impuesta por response_schema. No agregues campos extra."
    )


CLASSIFIER_INSTRUCTIONS = """\
Clasificás segmentos de 60s de la transcripción de una clase WE.
Etiquetas:

  TEORIA   — explicación expositiva: define, contextualiza, slides, storytelling.
  PRACTICA — ejercicios en vivo, alumnos ejecutan, revisión de talleres.
  MIXTO    — explica + ejecuta en proporciones similares.
  ADMIN    — saludo, asistencia, recordatorios, breaks. NO cuenta para ratio.

Devuelve JSON: {"segmentos":[{"inicio":"MM:SS","fin":"MM:SS","etiqueta":"...","razon":"<8 palabras"}]}
"""


CLASSIFIER_RESPONSE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "segmentos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "inicio":   {"type": "string"},
                    "fin":      {"type": "string"},
                    "etiqueta": {"type": "string", "enum": ["TEORIA", "PRACTICA", "MIXTO", "ADMIN"]},
                    "razon":    {"type": "string"},
                },
                "required": ["inicio", "fin", "etiqueta"],
            },
        },
    },
    "required": ["segmentos"],
}


def get_auditor_system_instruction() -> str:
    """Solo el texto. Los PDFs van como Part en auditor.py (no como texto)."""
    return _format_instructions()
