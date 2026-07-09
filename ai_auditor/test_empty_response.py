"""Check mínimo del fix 09/07: respuesta vacía de Gemini se reintenta como
transitoria y, si persiste, degrada el batch a ADMIN en vez de tumbar la auditoría.

Correr: python test_empty_response.py
No requiere google-genai ni dotenv instalados (se stubean): corre en cualquier
entorno, incluido Windows sin el venv del servicio.
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
)
google.genai = genai_mod
genai_mod.types = types_mod
_stub("dotenv", load_dotenv=lambda *a, **k: None)

import classifier
from classifier import EmptyResponseError, _classify_one_batch
from retry import is_transient


def main():
    # 1. Vacía = transitoria → with_retry la reintenta.
    assert is_transient(EmptyResponseError("RECITATION"))

    # 2. Si el clasificador devuelve [] (bloqueo persistente), el batch completa
    #    degradado a ADMIN: pide, re-pide una vez, y no lanza.
    calls = []
    classifier._call_classifier = lambda client, blocks, bn, tb: (calls.append(1), [])[1]
    blocks = [{"inicio_seg": 0.0, "fin_seg": 60.0, "transcript_excerpt": "video institucional"}]
    out = _classify_one_batch(None, blocks, 1, 1)
    assert len(out) == 1
    assert out[0].etiqueta == "ADMIN"
    assert "degradado" in out[0].razon
    assert len(calls) == 2, f"esperaba pedido + re-pedido, hubo {len(calls)}"
    print("OK")


if __name__ == "__main__":
    main()
