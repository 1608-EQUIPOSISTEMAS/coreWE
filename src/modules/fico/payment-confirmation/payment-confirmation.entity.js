// Reglas e invariantes puras de la confirmacion de pago inicial / contado.
// Sin acceso a BD, Odoo, Slack ni reloj oculto: todo dato externo (la fila de
// la cuota objetivo, los flags de fecha ya calculados en TZ Lima por el SP) entra
// por parametros. Esto las hace testeables sin levantar infraestructura.

// Acciones de confirmacion soportadas por sp_fico_confirm_payment.
export const CONFIRM_CONTADO = 'confirm_contado'
export const CONFIRM_PLAN = 'confirm_plan'

// Tipo de pago del placeholder que sp_comercial_enrollment_register crea al
// confirmar un token (sin transaction_code). Se desactiva tras grabar el real.
export const CAT_PAYMENT_TYPE_PLACEHOLDER = 3113

// Ventana maxima (meses) para diferir la activacion de una membresia.
export const MEMBERSHIP_ACTIVATION_WINDOW_MONTHS = 6

// Aliases de catalog que representan una cuota ya pagada. Cualquiera de los dos
// dispara el camino idempotente.
export const PAID_STATUS_ALIASES = ['we_inst_paid', 'we_payment_status_paid']

// Numero de cuota que paga cada accion:
//   confirm_contado -> 1 (pago unico)
//   confirm_plan    -> 0 (cuota inicial / reserva)
// Devuelve null si la accion no participa del guard de idempotencia.
export function targetInstallmentNumber (action) {
  if (action === CONFIRM_CONTADO) return 1
  if (action === CONFIRM_PLAN) return 0
  return null
}

// Indica si la accion participa del guard de idempotencia.
export function isIdempotencyEligible (action) {
  return action === CONFIRM_CONTADO || action === CONFIRM_PLAN
}

// Determina si el alias de estado de una cuota corresponde a 'pagada'.
export function isPaidStatusAlias (alias) {
  return PAID_STATUS_ALIASES.includes(alias)
}

// Valida el formato de activation_date. Solo aceptamos YYYY-MM-DD para evitar
// ambiguedad de timezone: el cliente debe mandar la fecha calendario explicita.
export function isValidActivationDateFormat (raw) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())
}

// Mapea los hechos ya calculados (en TZ Lima por el SP) a la decision de
// activacion de membresia. Logica pura: la aritmetica de fechas vive en SQL,
// aqui solo se interpreta el resultado.
//
// Inputs:
//   isMembershipProgram: bool   -> el enrollment es una membresia
//   rawDate: string|null        -> activation_date recibida del caller
//   isTodayOrPast: bool         -> $date <= hoy (Lima)
//   outOfWindow: bool           -> $date excede la ventana permitida
//   activationDate: string|null -> fecha normalizada por el SP
//   runAt: any                  -> timestamptz de ejecucion del job (9am Lima)
//
// Salidas:
//   { isMembership: false }
//   { isMembership: true, deferred: false, activationDate }
//   { isMembership: true, deferred: true, activationDate, runAt }
//   { error: '<motivo>' }
export function resolveMembershipActivationDecision ({
  isMembershipProgram,
  rawDate,
  isTodayOrPast,
  outOfWindow,
  activationDate,
  runAt
}) {
  if (!isMembershipProgram) return { isMembership: false }

  // Sin fecha: comportamiento legacy (activacion inmediata sin persistir fecha).
  if (!rawDate) return { isMembership: true, deferred: false, activationDate: null }

  if (!isValidActivationDateFormat(rawDate)) {
    return { error: 'activation_date debe ser YYYY-MM-DD' }
  }

  if (outOfWindow) {
    return { error: `activation_date excede la ventana permitida (${MEMBERSHIP_ACTIVATION_WINDOW_MONTHS} meses)` }
  }

  if (isTodayOrPast) {
    return { isMembership: true, deferred: false, activationDate }
  }
  return { isMembership: true, deferred: true, activationDate, runAt }
}
