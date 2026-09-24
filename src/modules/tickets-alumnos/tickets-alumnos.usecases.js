import { ticketsRepository } from './tickets-alumnos.repository.js'
import {
  ACCION,
  ESTADO,
  TERMINALES,
  TicketError,
  areasDelUsuario,
  assertPuedeFirmar,
  avanzar,
  planDeEjecucion,
  rechazar,
  turnoDe
} from './tickets-alumnos.entity.js'
import { courseChange, reprogramEdition } from '../fico/enrollment/enrollment.usecases.js'
import { urlDeLectura } from '../../shared/adapters/storage/nexus-archivos.adapter.js'

// Los movimientos reales los hacen los casos de uso de FICO, que ya saben tocar
// cuotas, Odoo y el correo. Se inyectan para poder probar el orden sin BD.
const DEPENDENCIAS = {
  repo: ticketsRepository,
  ejecutor: { reprogramEdition, courseChange },
  archivos: { urlDeLectura }
}

function assertTieneArea (areas) {
  if (!areas.length) {
    throw new TicketError('Tu usuario no pertenece a Academica ni a Finanzas', 403)
  }
}

/**
 * Bandeja del area del usuario, mas los tickets que esperan el voucher del
 * alumno (no son de nadie, pero las dos areas necesitan verlos para contestar
 * "¿en que va mi tramite?"). El repositorio trae de mas y aca se filtra: la
 * regla de turnos vive en un solo sitio, la entity.
 */
export async function listarBandeja ({ roles, incluirCerrados, tipo, q }, { repo } = DEPENDENCIAS) {
  const areas = areasDelUsuario(roles)
  assertTieneArea(areas)

  const filas = await repo.listar({ incluirCerrados, tipo, q })
  return filas
    .filter(t => {
      const turno = turnoDe(t)
      return areas.includes(turno) || (turno === null && (incluirCerrados || t.status === ESTADO.PENDIENTE_PAGO))
    })
    .map(t => {
      const plan = planDeEjecucion(t)
      return {
        ...t,
        area_actual: turnoDe(t),
        puede_firmar: areas.includes(turnoDe(t)) && !TERMINALES.includes(t.status),
        requiere_accion_manual: plan?.accion === ACCION.MANUAL ? plan.motivo : null
      }
    })
}

/**
 * Firma el paso del area. Si con esta firma el tramite queda resuelto y hay que
 * mover la matricula, se mueve ANTES de guardar: si FICO falla, el ticket sigue
 * pendiente y se puede reintentar, en vez de quedar "resuelto" sin haber hecho nada.
 */
export async function firmarTramite ({ solicitudId, respuesta, monto, roles, userId }, deps = DEPENDENCIAS) {
  const ticket = await tomarParaFirmar({ solicitudId, roles }, deps)
  const siguiente = avanzar(ticket, { monto })

  const ejecucion = siguiente.status === ESTADO.RESUELTA
    ? await ejecutarPlan(ticket, { userId, justificacion: respuesta }, deps)
    : null

  return deps.repo.guardarFirma({
    solicitudId,
    status: siguiente.status,
    areaActual: siguiente.area_actual,
    monto: siguiente.monto,
    respuesta,
    userId,
    cierra: siguiente.status === ESTADO.RESUELTA,
    datosExtra: ejecucion
  })
}

export async function rechazarTramite ({ solicitudId, respuesta, roles, userId }, deps = DEPENDENCIAS) {
  const ticket = await tomarParaFirmar({ solicitudId, roles }, deps)

  const siguiente = rechazar(ticket)
  return deps.repo.guardarFirma({
    solicitudId,
    status: siguiente.status,
    areaActual: siguiente.area_actual,
    monto: ticket.monto,
    respuesta,
    userId,
    cierra: true,
    datosExtra: null
  })
}

/** URL temporal del voucher o la evidencia que subio el alumno. */
export async function urlDeAdjunto ({ solicitudId, cual, roles }, { repo, archivos } = DEPENDENCIAS) {
  assertTieneArea(areasDelUsuario(roles))
  const ticket = await repo.obtener(solicitudId)
  if (!ticket) throw new TicketError('El ticket no existe', 404)

  const clave = cual === 'voucher' ? ticket.voucher_key : ticket.evidencia_key
  if (!clave) throw new TicketError('El alumno no adjunto ese archivo', 404)

  const url = await archivos.urlDeLectura(clave)
  if (!url) throw new TicketError('Falta configurar el bucket de Nexus (NEXUS_GCS_BUCKET)', 503)
  return { url }
}

async function ejecutarPlan (ticket, { userId, justificacion }, { repo, ejecutor }) {
  const plan = planDeEjecucion(ticket)
  if (!plan || plan.accion === ACCION.MANUAL) return null

  const nota = `Tramite del portal ${ticket.ticket_number}${justificacion ? `: ${justificacion}` : ''}`
  const resultado = plan.accion === ACCION.REPROGRAMAR
    ? await ejecutor.reprogramEdition({
      enrollmentId: plan.enrollmentId, newEditionId: plan.destEditionId, justificacion: nota, userId
    })
    : await ejecutor.courseChange({
      enrollmentId: plan.enrollmentId,
      newProgramVersionId: plan.destProgramVersionId,
      newEditionId: plan.destEditionId,
      // Mismo criterio que reprogramacion.usecases: el destino no cobra nada
      // nuevo y hereda las cuotas pendientes. La diferencia de precio la ve
      // Finanzas aparte (course_change_diff), acordado el 24/09/26.
      totalAmount: 0,
      justificacion: nota,
      userId,
      cat_currency: await repo.monedaDeVenta(plan.enrollmentId)
    })
  return { nuevoEnrollmentId: resultado.new_enrollment_id }
}

// Lo comun a firmar y rechazar: traer el ticket y verificar que a quien lo pide
// le toca ese paso. Va contra la BD y no contra lo que mando el front, que es
// justo el dato que un cliente manipulado falsearia.
async function tomarParaFirmar ({ solicitudId, roles }, { repo }) {
  const areas = areasDelUsuario(roles)
  assertTieneArea(areas)

  const ticket = await repo.obtener(solicitudId)
  assertPuedeFirmar(ticket, areas)
  return ticket
}
