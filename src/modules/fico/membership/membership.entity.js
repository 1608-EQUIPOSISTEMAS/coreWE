import { DomainError } from '../../../shared/errors.js'
import { isMembership } from '../../../utils/fico-formatters.js'

// Reglas e invariantes puras del dominio de membresias con activacion diferida.
// Sin acceso a BD, red ni reloj oculto: el "hoy" y las fechas entran por
// parametros como strings YYYY-MM-DD para que la clasificacion sea testeable
// sin levantar Postgres. El calculo real de la ventana/runAt en TZ Lima vive en
// el repository (SQL verbatim del legacy); aqui validamos formato y derivamos
// el flujo (inmediato vs diferido) a partir de banderas ya resueltas.

// Ventana maxima entre hoy y la fecha de activacion solicitada. Fuera de este
// rango la solicitud se rechaza.
export const MEMBERSHIP_ACTIVATION_WINDOW_MONTHS = 6

// Re-exportada para que el resto del subdominio resuelva la clasificacion de
// programa por el mismo punto. El flag explicito programs.is_membership manda;
// solo cae a heuristica de nombre cuando no se pasa el flag.
export { isMembership }

// Patron canonico de fecha calendario. Aceptamos solo YYYY-MM-DD para evitar
// ambiguedad de timezone: el cliente debe mandar la fecha explicita.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Valida el formato de una fecha de activacion. Devuelve la fecha trimmeada si
// es valida o un string de error con el motivo. No interpreta la fecha (eso lo
// hace SQL en TZ Lima), solo verifica la forma.
export function validateActivationDateFormat (raw) {
  const trimmed = String(raw ?? '').trim()
  if (!DATE_PATTERN.test(trimmed)) {
    return { ok: false, error: 'activation_date debe ser YYYY-MM-DD' }
  }
  return { ok: true, value: trimmed }
}

// Traduce el resultado de la comparacion de ventana (resuelta en SQL TZ Lima) a
// la decision de flujo. Recibe banderas ya calculadas y devuelve el modo:
//   { mode: 'out_of_window' }                 -> rechazar
//   { mode: 'immediate', activationDate }     -> activacion hoy o pasado, sincrono
//   { mode: 'deferred', activationDate, runAt }
//
// isTodayOrPast y outOfWindow son booleanos que vienen del repository; runAt y
// activationDate son los valores ya resueltos. Mantener esta decision pura
// permite probar la ramificacion sin tocar la BD.
export function classifyActivation ({ isTodayOrPast, outOfWindow, activationDate, runAt }) {
  if (outOfWindow) return { mode: 'out_of_window' }
  if (isTodayOrPast) return { mode: 'immediate', activationDate }
  return { mode: 'deferred', activationDate, runAt }
}

// Mensaje de rechazo por fecha fuera de la ventana permitida. Centralizado para
// que resolve y update emitan exactamente el mismo texto.
export function outOfWindowMessage () {
  return `activation_date excede la ventana permitida (${MEMBERSHIP_ACTIVATION_WINDOW_MONTHS} meses)`
}

// Defensa pura usada por enroll/email: dada la fecha de activacion persistida y
// el "hoy" (ambos YYYY-MM-DD en TZ Lima), indica si la activacion sigue siendo
// futura. Cuando es futura, los efectos externos deben abortar y dejar que el
// job en cola los procese al llegar la fecha.
export function isActivationDeferred (activationDate, todayLima) {
  if (!activationDate) return false
  return String(activationDate) > String(todayLima)
}

// Reglas de reprogramacion de fecha (FICO mueve la activacion). Recibe el estado
// ya leido de BD y la clasificacion de la nueva fecha; lanza DomainError con el
// mensaje del legacy si la operacion no esta permitida. No persiste nada.
export function assertReschedulable ({ found, isMembershipProgram, emailAlreadySent }, classification) {
  if (!found) throw new DomainError('Inscripcion no encontrada', { statusCode: 404, code: 'NOT_FOUND' })
  if (!isMembershipProgram) throw new DomainError('Esta inscripcion no es membresia')
  if (emailAlreadySent) {
    throw new DomainError('El correo de bienvenida ya fue enviado. La fecha no puede cambiarse.')
  }
  if (classification.mode === 'immediate') {
    throw new DomainError('La nueva fecha debe ser posterior a hoy. Para activar hoy, use el envio directo.')
  }
  if (classification.mode === 'out_of_window') {
    throw new DomainError(`La nueva fecha excede la ventana permitida (${MEMBERSHIP_ACTIVATION_WINDOW_MONTHS} meses)`)
  }
}
