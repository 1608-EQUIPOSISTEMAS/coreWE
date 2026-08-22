"""Check mínimo del fix 21/08/26: si Gemini inventa un criterio fuera de la
rúbrica (el famoso #10 "Criterio extra" con score 1), se descarta y la nota
global se recalcula sobre los 9 reales.

Correr: python test_extra_criterio.py
No requiere google-genai ni dotenv (se stubean): corre sin el venv del servicio.
"""
import sys
import types


def _stub(name, **attrs):
    if name not in sys.modules:
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod
    return sys.modules[name]


google = _stub("google")
genai_mod = _stub("google.genai", Client=object)
types_mod = _stub(
    "google.genai.types",
    GenerateContentConfig=lambda **k: None,
    ThinkingConfig=lambda **k: None,
    Part=object,
)
google.genai = genai_mod
genai_mod.types = types_mod
_stub("dotenv", load_dotenv=lambda *a, **k: None)

from auditor import _drop_extra_criterios


def main():
    scores_reales = [5, 4, 5, 4, 3, 4, 5, 3, 5]  # promedio 4.2 → 17/20
    report = {
        "criterios": [
            {"id": i, "nombre": f"C{i}", "score": s}
            for i, s in enumerate(scores_reales, start=1)
        ] + [{"id": 10, "nombre": "Criterio extra", "score": 1}],
        "metricas_rapidas": {"puntuacion_global": 3.9},
    }

    _drop_extra_criterios(report)

    assert len(report["criterios"]) == 9
    assert all(c["id"] <= 9 for c in report["criterios"])
    assert report["metricas_rapidas"]["puntuacion_global"] == 4.2
    print("OK")


if __name__ == "__main__":
    main()
