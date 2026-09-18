import { ticketsRepository } from './tickets.repository.js'
import {
  ESTADO,
  TicketError,
  areaInicial,
  areasDelUsuario,
  assertPuedeFirmar,
  avanzar,
  rechazar
} from './tickets.entity.js'

const repo = ticketsRepository

/** El turno real de un ticket: `area_actual`, o el primer paso si nadie lo tomo. */
const turnoDe = ticket => ticket.area_actual || areaInicial(ticket.tipo)

function assertTieneArea (areas) {
  if (!areas.length) {
    throw new TicketError('Tu usuario no pertenece a Academica ni a Finanzas', 403)
  }
}

/**
 * Bandeja del area del usuario. El repositorio trae de mas —los tickets sin
 * rutear (`area_actual IS NULL`)— y aca se descartan los que no son del area:
 * asi la tabla de pasos vive en un solo sitio (la entity) en vez de repetirse
 * como un CASE dentro del SQL.
 */
export async function listarBandeja ({ roles, incluirCerrados, tipo, q }) {
  const areas = areasDelUsuario(roles)
  assertTieneArea(areas)

  const filas = await repo.listar({ areas, incluirCerrados, tipo, q })
  return filas
    .filter(t => areas.includes(turnoDe(t)))
    .map(t => ({ ...t, area_actual: turnoDe(t), puede_firmar: t.status !== ESTADO.RESUELTA && t.status !== ESTADO.RECHAZADA }))
}

export async function firmarTramite ({ solicitudId, respuesta, roles, userId }) {
  const ticket = await tomarParaFirmar({ solicitudId, roles })
  const siguiente = avanzar({ ...ticket, area_actual: turnoDe(ticket) })

  return repo.guardarFirma({
    solicitudId,
    status: siguiente.status,
    areaActual: siguiente.area_actual,
    respuesta,
    userId,
    cierra: siguiente.status === ESTADO.RESUELTA
  })
}

export async function rechazarTramite ({ solicitudId, respuesta, roles, userId }) {
  await tomarParaFirmar({ solicitudId, roles })

  const siguiente = rechazar()
  return repo.guardarFirma({
    solicitudId,
    status: siguiente.status,
    areaActual: siguiente.area_actual,
    respuesta,
    userId,
    cierra: true
  })
}

// Lo comun a firmar y rechazar: traer el ticket y verificar que a quien lo pide
// le toca ese paso. Va contra la BD y no contra lo que mando el front, que es
// justo el dato que un cliente manipulado falsearia.
async function tomarParaFirmar ({ solicitudId, roles }) {
  const areas = areasDelUsuario(roles)
  assertTieneArea(areas)

  const ticket = await repo.obtener(solicitudId)
  assertPuedeFirmar(ticket, areas)
  return ticket
}
