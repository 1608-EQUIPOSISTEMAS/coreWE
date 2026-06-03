"""Rúbrica de puntuación 1-5 por criterio.

Borrador anclado en los manuales WE (pedagogía + buenas prácticas). Cada
criterio define qué observación concreta da un 5, un 3 y un 1. Estos textos
van LITERAL al prompt de Gemini → entre más específicos, más reproducibles y
defendibles los puntajes. El equipo pedagógico puede afinar los umbrales.

Reglas para escribir bien una rúbrica:
  1) Conducta observable, no juicio (✓ "≥30 min de práctica autónoma con
     instrucciones escritas"  ✗ "el taller estuvo bien").
  2) Umbrales numéricos cuando se puedan ("≥3 ejemplos reales", "<10 muletillas").
  3) Anchors solo en 5/3/1; el 4 y el 2 son interpolación.
  4) Distinguible: si dos niveles podrían describir la misma sesión,
     reescribilos. Si no podés distinguirlos, fusionalos.
"""
from __future__ import annotations

# Cada entrada: id, nombre y los 3 anchors (5/3/1). Borrador anclado en la
# metodología WE de los manuales (etapas Descubre-Aprende-Crea, taller guiado
# vs dirigido, estructura de sesión, competencias docente). El equipo
# pedagógico puede ajustar umbrales; mantener conducta observable y numérica.
CRITERIOS = [
    {
        "id": 1,
        "nombre": "Alineación con el temario",
        "anchor_5": "Cubre el 100% de los temas del syllabus de la sesión, dedica >=5 min a cada uno y los conecta entre sí y con la sesión previa.",
        "anchor_3": "Cubre los temas del syllabus pero >=1 queda superficial (<3 min) o altera el orden sin justificarlo.",
        "anchor_1": "Omite >=1 tema oficial del syllabus o introduce temas no listados sin avisar; la sesión no sigue el temario.",
    },
    {
        "id": 2,
        "nombre": "Estructura de la sesión",
        "anchor_5": "Apertura con motivación (caso/anécdota real) y agenda visible; recorre las etapas Descubre-Aprende-Crea con transiciones anunciadas; cierre con síntesis y próximos pasos; break ~5 min al intermedio.",
        "anchor_3": "Estructura presente pero falta una etapa o las transiciones no se anuncian; apertura o cierre débiles.",
        "anchor_1": "Sin estructura reconocible: arranca sin encuadre, salta entre temas sin transición y/o termina sin síntesis.",
    },
    {
        "id": 3,
        "nombre": "Nivel de profundidad",
        "anchor_5": "Cada concepto clave se explica, se ilustra con caso real, se aplica en actividad y se contrasta con alternativas o errores comunes.",
        "anchor_3": "Los conceptos se explican e ilustran pero rara vez se aplican o contrastan; profundidad despareja entre temas.",
        "anchor_1": "Tratamiento solo superficial: definiciones sin ejemplo ni aplicación, a nivel de lista de conceptos.",
    },
    {
        "id": 4,
        "nombre": "Uso de casos y ejemplos",
        "anchor_5": ">=3 casos reales del mundo profesional (datos/archivos reales o experiencia propia del docente) conectados al rol del alumno.",
        "anchor_3": "1-2 casos reales o varios ejemplos genéricos/teóricos; conexión parcial con la práctica profesional.",
        "anchor_1": "Sin casos reales; solo ejemplos abstractos o de manual.",
    },
    {
        "id": 5,
        "nombre": "Calidad de talleres y actividades",
        "anchor_5": ">=1 taller dirigido con instrucciones explícitas y >=20 min de práctica autónoma donde los alumnos ejecutan (no observan), precedido de taller guiado.",
        "anchor_3": "Hay actividad práctica pero <10 min de intento autónomo o el docente la resuelve a la vista de los alumnos.",
        "anchor_1": "No hay taller dirigido real; solo demostración del docente o teoría continua.",
    },
    {
        "id": 6,
        "nombre": "Claridad y comunicación docente",
        "anchor_5": "Lenguaje preciso y ordenado, transiciones fluidas, <5 muletillas en toda la sesión, audio limpio; verifica comprensión antes de avanzar.",
        "anchor_3": "Comunicación entendible pero con muletillas frecuentes, digresiones o explicaciones que requieren repetición.",
        "anchor_1": "Exposición confusa o desordenada, audio deficiente o ritmo que impide seguir la idea.",
    },
    {
        "id": 7,
        "nombre": "Engagement e interacción",
        "anchor_5": "Toma asistencia llamando por nombre + >=1 dinámica en vivo (Kahoot, ruleta, pizarra) + >=10 intervenciones de alumnos respondidas por nombre.",
        "anchor_3": "Algunas preguntas al aire con pocas respuestas; participación esporádica sin dinámica estructurada.",
        "anchor_1": "Monólogo durante >70% de la sesión; ninguna intervención de alumnos registrada.",
    },
    {
        "id": 8,
        "nombre": "Gestión del tiempo",
        "anchor_5": "Cada bloque dentro de +-5 min de lo planificado, break al intermedio, cierre completo con síntesis dentro del horario.",
        "anchor_3": "Algún bloque se extiende y comprime otro; cierre apurado pero presente; termina cerca del horario.",
        "anchor_1": "Un bloque consume >50% del tiempo, se omite el cierre, o la sesión excede/queda muy corta respecto a lo planificado.",
    },
    {
        "id": 9,
        "nombre": "Valor percibido para el participante",
        "anchor_5": "El alumno sale con >=3 herramientas o aprendizajes aplicables esta semana en su trabajo, con conexión explícita a su rol y empleabilidad.",
        "anchor_3": "Aporta valor pero la transferencia al trabajo del alumno queda implícita o limitada a 1 herramienta.",
        "anchor_1": "Contenido sin aplicación práctica visible para el rol del alumno; valor profesional no evidente.",
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
