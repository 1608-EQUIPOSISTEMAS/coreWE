import { formatTicketCode } from '../tickets.entity.js'
import { escaparSlack } from './slack.text.js'

// Lista de tickets abiertos para la consulta de avance por DM ("como van mis
// tickets"). Sale de la BD y se arma con plantilla: la IA no redacta estados.

export const ESTADO_LEGIBLE = {
  ABIERTO: '🆕 Abierto, esperando que lo tomen',
  EN_PROGRESO: '👀 En progreso',
  CERRADO: '✅ Cerrado'
}

const SIN_ACTIVOS =
  '📭 No tienes tickets abiertos ahora mismo.\n' +
  'Si algo dejó de funcionar, escríbeme de qué se trata y te abro uno.'

/** La lista de tickets abiertos, uno por bloque de dos lineas. */
export function textoDeEstado (activos = []) {
  if (!activos.length) return SIN_ACTIVOS

  const filas = activos.map(t => [
    `• *#${formatTicketCode(t.ticket_id)}* — ${escaparSlack(t.title)}`,
    `   ${ESTADO_LEGIBLE[t.status] ?? t.status} · Prioridad ${t.priority} · Atiende: ${escaparSlack(t.asignado ?? 'aún sin asignar')}`
  ].join('\n'))

  return [`📋 *Tus tickets abiertos (${activos.length}):*`, ...filas].join('\n')
}
