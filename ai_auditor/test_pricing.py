"""Check del costo real de una auditoria (05/10/2026). Correr: python test_pricing.py"""
from types import SimpleNamespace
from pricing import cost_usd, add_usage

# Auditoria tipica en prod: 72K entrada, 2.7K salida, 1.8K thinking en 3.1 Pro.
auditor = cost_usd("gemini-3.1-pro-preview", input_tokens=72_000, output_tokens=2_700, thinking_tokens=1_800)
assert abs(auditor - 0.198) < 0.001, auditor

# El cache cobra su tarifa, no la de entrada.
assert cost_usd("gemini-3.1-pro-preview", input_tokens=1_000_000, output_tokens=0, cached_tokens=1_000_000) == 0.20

# Sin tarifa no se inventa un 0.
try:
    cost_usd("modelo-nuevo", input_tokens=1, output_tokens=1)
    raise AssertionError("debio fallar")
except KeyError:
    pass

acc = {}
for _ in range(2):
    add_usage(acc, SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=100, candidates_token_count=10, thoughts_token_count=None, cached_content_token_count=5)))
assert acc == {"input": 200, "output": 20, "thinking": 0, "cached": 10}, acc
print("ok")
