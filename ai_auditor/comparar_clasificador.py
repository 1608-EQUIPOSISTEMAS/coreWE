"""Compara el clasificador actual contra uno mas barato con las MISMAS clases.

Lo que entra a la nota es el % de teoria/practica (compute_ratio), asi que se
mide: coincidencia de etiquetas bloque a bloque, diferencia de % teoria y
costo de cada modelo. Gasta tokens reales (una clasificacion por modelo y clase).

Uso (desde Backend/ai_auditor, con GEMINI_API_KEY en .env y las deps instaladas):
  python comparar_clasificador.py                      # todos los .txt/.vtt de pruebas/
  python comparar_clasificador.py gemini-3.5-flash-lite gemini-3.1-flash-lite
Cada archivo de pruebas/ es el transcript TAL CUAL se pega en el ERP.
"""
from __future__ import annotations
import sys
from pathlib import Path

import classifier
from classifier import chunk_transcript, compute_ratio
from pricing import cost_usd
from transcription import parse_manual_transcript

BASE = "gemini-3.5-flash"
CANDIDATES = sys.argv[1:] or ["gemini-3.5-flash-lite"]
# Diferencia de % teoria a partir de la cual el candidato cambiaria la nota.
TOLERANCIA_PP = 3.0


def clasificar(model: str, blocks: list[dict]):
    classifier.GEMINI_CLASSIFIER_MODEL = model  # el modulo lo lee en cada llamada
    usage: dict = {}
    out = classifier.classify_blocks(blocks, usage)
    costo = cost_usd(model, input_tokens=usage.get("input", 0), output_tokens=usage.get("output", 0),
                     thinking_tokens=usage.get("thinking", 0), cached_tokens=usage.get("cached", 0))
    return out, costo


def main() -> None:
    files = sorted(p for p in Path("pruebas").iterdir() if p.suffix.lower() in {".txt", ".vtt"})
    if not files:
        sys.exit("Pon transcripts en Backend/ai_auditor/pruebas/ (.txt o .vtt)")
    resumen = {m: {"coinc": [], "dif": [], "costo": 0.0} for m in CANDIDATES}
    costo_base = 0.0
    for f in files:
        blocks = chunk_transcript(parse_manual_transcript(f.read_text(encoding="utf-8")))
        base, c0 = clasificar(BASE, blocks)
        costo_base += c0
        t0 = compute_ratio(base)["porcentaje_teoria"]
        print(f"\n{f.name}: {len(blocks)} bloques | {BASE}: teoria {t0}%  US${c0:.3f}")
        for m in CANDIDATES:
            cand, c1 = clasificar(m, blocks)
            t1 = compute_ratio(cand)["porcentaje_teoria"]
            coinc = 100 * sum(a.etiqueta == b.etiqueta for a, b in zip(base, cand)) / max(len(base), 1)
            r = resumen[m]
            r["coinc"].append(coinc); r["dif"].append(abs(t1 - t0)); r["costo"] += c1
            distintos = [(a.inicio_seg // 60, a.etiqueta, b.etiqueta) for a, b in zip(base, cand) if a.etiqueta != b.etiqueta]
            print(f"   {m}: teoria {t1}% (dif {t1 - t0:+.1f} pp) | coincide {coinc:.0f}% | US${c1:.3f}")
            print(f"      min:base->cand {distintos[:12]}")
    print(f"\nRESUMEN ({len(files)} clases) | {BASE}: US${costo_base:.3f}")
    for m, r in resumen.items():
        n = len(r["dif"])
        ok = max(r["dif"]) <= TOLERANCIA_PP
        print(f"  {m}: coincide {sum(r['coinc']) / n:.0f}% | dif teoria prom {sum(r['dif']) / n:.1f} pp, max {max(r['dif']):.1f} pp"
              f" | US${r['costo']:.3f} ({100 * r['costo'] / costo_base:.0f}% del actual) | {'APTO' if ok else 'NO APTO: cambia la nota'}")


if __name__ == "__main__":
    main()
