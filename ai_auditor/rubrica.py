"""Rúbrica de puntuación 1-5 por criterio.

ESTE ARCHIVO REQUIERE TU INPUT — sos el experto en pedagogía ejecutiva.
Para cada criterio, definí qué observación concreta da un 5, un 3 y un 1.
Estos textos van LITERAL al prompt de Gemini → entre más específicos,
más reproducibles y defendibles los puntajes.

Reglas para escribir bien una rúbrica:
  1) Conducta observable, no juicio (✓ "≥30 min de práctica autónoma con
     instrucciones escritas"  ✗ "el taller estuvo bien").
  2) Umbrales numéricos cuando se puedan ("≥3 ejemplos reales", "<10 muletillas").
  3) Anchors solo en 5/3/1; el 4 y el 2 son interpolación.
  4) Distinguible: si dos niveles podrían describir la misma sesión,
     reescribilos. Si no podés distinguirlos, fusionalos.
"""
from __future__ import annotations

# Cada entrada: id, nombre y los 3 anchors.
# TODO(usuario): completar el contenido entre los <<< y >>>.
CRITERIOS = [
    {
        "id": 1,
        "nombre": "Alineación con el temario",
        "anchor_5": "<<<TODO: ej. 'cubre los 7 temas oficiales del syllabus, dedica >5 min a cada uno y los conecta entre sí'>>>",
        "anchor_3": "<<<TODO: ej. 'cubre los temas pero algunos quedan superficiales o cambia el orden sin justificar'>>>",
        "anchor_1": "<<<TODO: ej. 'omite ≥2 temas oficiales o agrega temas no listados sin avisar'>>>",
    },
    {
        "id": 2,
        "nombre": "Estructura de la sesión",
        "anchor_5": "<<<TODO: ej. 'inicio con motivación + agenda visible, transiciones anunciadas entre bloques, cierre con síntesis y next steps'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO>>>",
    },
    {
        "id": 3,
        "nombre": "Nivel de profundidad",
        "anchor_5": "<<<TODO: ej. 'cada concepto se explica + se ilustra con caso real + se aplica + se contrasta con alternativas'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO>>>",
    },
    {
        "id": 4,
        "nombre": "Uso de casos y ejemplos",
        "anchor_5": "<<<TODO: ej. '≥3 casos reales del mundo profesional, archivos/datasets reales, no demos genéricas'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO>>>",
    },
    {
        "id": 5,
        "nombre": "Calidad de talleres y actividades",
        "anchor_5": "<<<TODO: ej. 'instrucciones escritas, ≥20 min de práctica autónoma por taller, alumnos ejecutan no observan'>>>",
        "anchor_3": "<<<TODO: ej. 'taller existe pero alumnos miran al docente resolver, <10 min de intento autónomo'>>>",
        "anchor_1": "<<<TODO: ej. 'no hay taller real, solo demostración del docente'>>>",
    },
    {
        "id": 6,
        "nombre": "Claridad y comunicación docente",
        "anchor_5": "<<<TODO: ej. 'lenguaje preciso, transiciones fluidas, <5 muletillas en toda la sesión, audio limpio'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO>>>",
    },
    {
        "id": 7,
        "nombre": "Engagement e interacción",
        "anchor_5": "<<<TODO: ej. 'Kahoot/preguntas en vivo, ≥10 intervenciones de alumnos respondidas por nombre, manos levantadas en cámara'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO: ej. 'monólogo durante >70% de la sesión, ninguna intervención registrada'>>>",
    },
    {
        "id": 8,
        "nombre": "Gestión del tiempo",
        "anchor_5": "<<<TODO: ej. 'cada bloque dentro de ±5 min de lo planificado, cierre completo con síntesis'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO: ej. 'un bloque consume >50% del tiempo planificado, cierre apurado o ausente'>>>",
    },
    {
        "id": 9,
        "nombre": "Valor percibido para el participante",
        "anchor_5": "<<<TODO: ej. 'alumno sale con ≥3 herramientas aplicables esta semana en su trabajo, conexión explícita con su rol'>>>",
        "anchor_3": "<<<TODO>>>",
        "anchor_1": "<<<TODO>>>",
    },
]


def render_rubric_for_prompt() -> str:
    """Renderiza la rúbrica para inyectarla en el system_instruction.

    Si algún anchor todavía dice TODO, igual la deja pasar pero la marca,
    así Gemini reduce confianza en ese criterio.
    """
    lines = []
    for c in CRITERIOS:
        lines.append(f"\n  Criterio {c['id']} — {c['nombre']}:")
        for level, key in [(5, "anchor_5"), (3, "anchor_3"), (1, "anchor_1")]:
            text = c[key]
            tag = " [SIN RÚBRICA — usá tu mejor juicio]" if "TODO" in text else ""
            lines.append(f"    {level}: {text}{tag}")
    return "\n".join(lines)


def criterios_for_schema() -> list[dict]:
    """Lista mínima (id + nombre) para inyectar en el response_schema."""
    return [{"id": c["id"], "nombre": c["nombre"]} for c in CRITERIOS]
