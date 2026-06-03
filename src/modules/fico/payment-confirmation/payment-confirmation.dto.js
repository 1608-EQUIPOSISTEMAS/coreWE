// Borde de salida de la confirmacion de pago. El SP y la orquestacion devuelven
// un objeto { result, message, ... } enriquecido (membership_deferred,
// activation_date, scheduled_job_id, validation_errors, already_confirmed). Hoy
// es passthrough para mantener paridad con el service legacy; endurecer a
// allowlist cuando el contrato con el front este fijado.

export const toConfirmPaymentDto = result => result
