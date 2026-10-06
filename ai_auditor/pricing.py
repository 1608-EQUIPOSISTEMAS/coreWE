"""Tarifas de Gemini (USD por 1M tokens, tier pagado, prompts <= 200K).

Fuente: https://ai.google.dev/gemini-api/docs/pricing (revisado 05/10/2026).
Si Google cambia precios o se cambia de modelo, se actualiza AQUI: el ERP usa
este costo para el tope mensual de auditorias IA. El thinking se factura a
precio de output.
"""
from __future__ import annotations

PRICES = {
    "gemini-3.1-pro-preview": {"input": 2.00, "output": 12.00, "cached": 0.20},
    "gemini-3.5-flash": {"input": 1.50, "output": 9.00, "cached": 0.15},
    "gemini-3.5-flash-lite": {"input": 0.30, "output": 2.50, "cached": 0.03},
}


def cost_usd(model: str, *, input_tokens: int, output_tokens: int,
             thinking_tokens: int = 0, cached_tokens: int = 0) -> float:
    """Costo de una o varias llamadas a `model`. Modelo sin tarifa = error:
    un costo en 0 dejaria pasar el tope mensual sin control."""
    if model not in PRICES:
        raise KeyError(f"Sin tarifa para {model}: agregala en pricing.py")
    p = PRICES[model]
    fresh = max(input_tokens - cached_tokens, 0)
    return (fresh * p["input"] + cached_tokens * p["cached"]
            + (output_tokens + thinking_tokens) * p["output"]) / 1_000_000


def add_usage(acc: dict, response) -> None:
    """Suma el usage_metadata de una respuesta de Gemini al acumulador."""
    u = getattr(response, "usage_metadata", None)
    for key, attr in (("input", "prompt_token_count"), ("output", "candidates_token_count"),
                      ("thinking", "thoughts_token_count"), ("cached", "cached_content_token_count")):
        acc[key] = acc.get(key, 0) + (getattr(u, attr, 0) or 0)
