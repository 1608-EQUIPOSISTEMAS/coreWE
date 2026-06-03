// Borde de salida del subdominio de cuotas. Hoy las respuestas son objetos de
// resultado planos ({ result, message, ... }) identicos al service legacy: el
// mapeo es passthrough para mantener paridad de contrato con el frontend.
// Endurecer a allowlist cuando el contrato este fijado.

export const toResultDto = result => result
