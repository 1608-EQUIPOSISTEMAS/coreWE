// Borde de salida del sync Odoo hacia el cliente. El endpoint legacy devuelve el
// objeto de resultado tal cual (passthrough), por lo que se mantiene la paridad
// exacta. Endurecer a allowlist cuando el contrato con el front este fijado.

export const toEnrollInOdooDto = result => result
