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

// ── Catalogo de cursos online incluidos en la membresia ─────────────────────
//
// Hasta ahora "todos los cursos online" era literal: enrollInAllOnlineCourses
// inscribia en CUALQUIER slide.channel con website_published = true. Publicar un
// curso nuevo en el Campus lo metia solo a toda membresia activada despues, que
// es el "agrega de mas" reportado. Ahora Configuracion mantiene una lista
// curada (tabla membership_online_courses) y esta funcion decide el set final.
//
// publishedChannels: [{ id, name }] leidos de Odoo en el momento de activar.
// configuredIds:     ids guardados en Configuracion (puede venir vacio).
// Devuelve { channels, usedFallback }.
//
// Lista vacia => se inscribe en TODOS los publicados y se marca usedFallback,
// que el usecase deja en el audit log. Es la opcion conservadora a proposito:
// una membresia activada con cero cursos no da error en ningun lado y solo se
// descubre cuando el alumno reclama.
//
// Un id configurado que ya no esta publicado en Odoo se ignora sin ruido: el
// resultado es la interseccion contra lo que Odoo devuelve hoy.
export function resolveMembershipChannels (publishedChannels = [], configuredIds = []) {
  const published = publishedChannels || []
  const wanted = new Set(configuredIds || [])
  if (wanted.size === 0) return { channels: published, usedFallback: true }
  return { channels: published.filter(c => wanted.has(c.id)), usedFallback: false }
}

// Reglas de reprogramacion de fecha (FICO mueve la activacion). Recibe el estado
// ya leido de BD y la clasificacion de la nueva fecha; lanza DomainError con el
// mensaje del legacy si la operacion no esta permitida. No persiste nada.
export function assertReschedulable ({ found, isMembershipProgram, alreadyActivated }, classification) {
  if (!found) throw new DomainError('Inscripcion no encontrada', { statusCode: 404, code: 'NOT_FOUND' })
  if (!isMembershipProgram) throw new DomainError('Esta inscripcion no es membresia')
  // El candado es la activacion, no el correo: la bienvenida sale el dia de la
  // inscripcion, asi que exigir que no haya salido bloquearia toda reprogramacion.
  // Una vez abiertos los cursos en Odoo, mover la fecha ya no significa nada.
  if (alreadyActivated) {
    throw new DomainError('La membresia ya fue activada. La fecha no puede cambiarse.')
  }
  if (classification.mode === 'immediate') {
    throw new DomainError('La nueva fecha debe ser posterior a hoy. Para activar hoy, use el envio directo.')
  }
  if (classification.mode === 'out_of_window') {
    throw new DomainError(`La nueva fecha excede la ventana permitida (${MEMBERSHIP_ACTIVATION_WINDOW_MONTHS} meses)`)
  }
}

// ── Vencimientos de membresia ──────────────────────────────────────────────
// La membresia da un año de beneficio desde su arranque (lo calcula SQL). FICO
// llama a los socios un mes antes de que venza para saber si renuevan o se les
// retira: esa es la ventana de "por vencer". La vista solo avisa; el retiro lo
// hace el area a mano.
export const RENEWAL_NOTICE_DAYS = 30

const DAY_MS = 86400000
const toUtcMs = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
export const daysBetween = (fromYmd, toYmd) => Math.round((toUtcMs(toYmd) - toUtcMs(fromYmd)) / DAY_MS)

export function expiryStatus (daysToExpiry) {
  if (daysToExpiry < 0) return 'expired'
  if (daysToExpiry <= RENEWAL_NOTICE_DAYS) return 'expiring'
  return 'active'
}

// Una membresia nueva renueva a la anterior si se compra cuando esta ya entro
// en la ventana de aviso o despues de vencer. Comprada antes (PLUS → BLACK a
// mitad de año) es un cambio de tier, no una renovacion: los cursos son los
// mismos en todos los tiers, asi que el socio no cambia nada.
export function isRenewal (previous, next) {
  return daysBetween(previous.expiry_date, next.start_date) >= -RENEWAL_NOTICE_DAYS
}

// Agrupa las membresias por persona: la vigente es la de arranque mas reciente
// y las anteriores solo cuentan como renovaciones. Devuelve una fila por socio,
// las mas proximas a vencer primero, y los totales por estado.
export function buildMembershipExpiries (rows, today) {
  const byPerson = new Map()
  for (const r of rows) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) || []), r])
  const items = [...byPerson.values()].map(memberships => {
    const ordered = memberships.toSorted((a, b) => a.start_date.localeCompare(b.start_date))
    const current = ordered.at(-1)
    const renewals = ordered.slice(1).filter((m, i) => isRenewal(ordered[i], m)).length
    const daysToExpiry = daysBetween(today, current.expiry_date)
    return { ...current, days_to_expiry: daysToExpiry, status: expiryStatus(daysToExpiry), renewals }
  })
  items.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))

  const kpis = { total: items.length, active: 0, expiring: 0, expired: 0, renewed: 0 }
  for (const it of items) {
    kpis[it.status]++
    if (it.renewals > 0) kpis.renewed++
  }
  return { today, items, kpis }
}
