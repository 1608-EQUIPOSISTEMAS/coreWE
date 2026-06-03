"""Reintentos con backoff exponencial para llamadas a Gemini.

Los errores transitorios (429 rate limit, 503 overloaded, 500 interno, timeouts
de red) son comunes en la API y se resuelven reintentando. Los errores de
cliente (400, schema inválido, API key) no se reintentan: fallarían igual y solo
agregarían latencia.
"""
from __future__ import annotations
import time
from typing import Callable, TypeVar

T = TypeVar("T")

_TRANSIENT_MARKERS = (
    "429", "500", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE",
    "INTERNAL", "DEADLINE", "TIMEOUT",
)


def is_transient(exc: Exception) -> bool:
    """True si el error parece transitorio y vale la pena reintentar."""
    signature = f"{type(exc).__name__} {exc}".upper()
    return any(marker in signature for marker in _TRANSIENT_MARKERS)


def with_retry(fn: Callable[[], T], *, attempts: int = 3, base_delay: float = 2.0) -> T:
    """Ejecuta fn() reintentando solo ante errores transitorios.

    Backoff exponencial: base_delay, base_delay*2, base_delay*4... Re-lanza el
    último error si se agotan los intentos o si el error no es transitorio.
    """
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            if not is_transient(exc) or attempt == attempts - 1:
                raise
            time.sleep(base_delay * (2 ** attempt))
    raise RuntimeError("with_retry: estado inalcanzable")  # pragma: no cover
