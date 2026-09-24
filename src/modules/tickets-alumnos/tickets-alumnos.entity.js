// Reglas puras del modulo Tickets de Alumnos. Sin I/O: se testean solas.
//
// El alumno abre el tramite desde el portal (Nexus) y este modulo lo resuelve.
// La tabla `solicitudes_portal` vive en la MISMA base que el ERP, asi que no hay
// integracion ni sincronizacion: Nexus escribe, aca se lee y se avanza.
//
// Flujo (rediseno del 24/09/26, ver la migracion 2026-09-24-erp-solicitudes-rediseno.sql
// de Nexus):
//
//   ABIERTA --Academica--> PENDIENTE_PAGO --alumno sube voucher--> PAGO_REGISTRADO --FICO--> RESUELTA
//      \-> RECHAZADA                                                      \-> PAGO_RECHAZADO
//
// Grabaciones, certificados y SAP se cobran al enviar: Nexus los crea ya en
// PAGO_REGISTRADO. El paso PENDIENTE_PAGO -> PAGO_REGISTRADO lo hace Nexus
// (es del alumno, no de un area); este modulo nunca lo firma.

export class TicketError extends Error {
  // statusCode viaja al error handler de buildApp. 403 y no 400 cuando el
  // problema es de permiso: el area equivocada no manda un dato malo, manda algo
  // que no le toca firmar.
  constructor (message, statusCode = 400) {
    super(message)
    this.name = 'TicketError'
    this.statusCode = statusCode
  }
}

export const ESTADO = {
  ABIERTA: 'ABIERTA',
  // Del flujo anterior: tickets que Academica ya firmo y esperan a FICO.
  EN_PROCESO: 'EN_PROCESO',
  PENDIENTE_PAGO: 'PENDIENTE_PAGO',
  PAGO_REGISTRADO: 'PAGO_REGISTRADO',
  RESUELTA: 'RESUELTA',
  RECHAZADA: 'RECHAZADA',
  PAGO_RECHAZADO: 'PAGO_RECHAZADO'
}

export const AREA = {
  ACADEMICA: 'ACADEMICA',
  FICO: 'FICO'
}

export const TERMINALES = [ESTADO.RESUELTA, ESTADO.RECHAZADA, ESTADO.PAGO_RECHAZADO]

// Tramites sin nada que cobrar despues de que Academica los aprueba.
const SIN_PAGO_TRAS_APROBAR = new Set(['FLEXIBILIDAD_HORARIA', 'CAMBIO_FLEX'])

// SAP no pasa por Academica: si Nexus lo deja ABIERTA es porque salio gratis y
// solo falta que FICO cree el usuario. Todo lo demas lo abre Academica.
//
// Un tipo que este modulo no conoce todavia (Nexus agrego uno y el ERP no se
// actualizo) cae en Academica en vez de quedarse sin dueno: un ticket que nadie
// ve es peor que uno mal ruteado.
export function areaInicial (tipo) {
  return tipo === 'ALQUILER_SAP' ? AREA.FICO : AREA.ACADEMICA
}

/** A quien le toca el ticket. null = al alumno (tiene que pagar) o a nadie (cerrado). */
export function turnoDe (ticket) {
  if (TERMINALES.includes(ticket.status)) return null
  if (ticket.status === ESTADO.PENDIENTE_PAGO) return null
  if (ticket.status === ESTADO.PAGO_REGISTRADO) return AREA.FICO
  return ticket.area_actual || areaInicial(ticket.tipo)
}

// El area a la que pertenece quien esta logueado. ADMIN puede firmar cualquier
// paso: es el desempate cuando un area esta sin personal, y ya es el criterio
// del resto del ERP.
export function areasDelUsuario (roles = []) {
  if (roles.includes('ADMIN')) return [AREA.ACADEMICA, AREA.FICO]
  const areas = []
  if (roles.includes('ACADEMICA') || roles.includes('LIDER_ACADEMICA')) areas.push(AREA.ACADEMICA)
  if (roles.includes('FICO') || roles.includes('LIDER_FICO')) areas.push(AREA.FICO)
  return areas
}

// El corazon del modulo: ver la bandeja no es poder firmar. Las dos areas miran
// los mismos tickets, asi que sin esta guarda Academica podria dar por validado
// el pago que le toca a FICO y el tramite se ejecutaria sin que nadie lo cobre.
export function assertPuedeFirmar (ticket, areas = []) {
  if (!ticket) throw new TicketError('El ticket no existe')
  if (TERMINALES.includes(ticket.status)) {
    throw new TicketError('Ese tramite ya esta cerrado')
  }
  if (ticket.status === ESTADO.PENDIENTE_PAGO) {
    throw new TicketError('El alumno todavia no adjunto el voucher de pago')
  }
  const turno = turnoDe(ticket)
  if (!areas.includes(turno)) {
    throw new TicketError(`Este tramite lo tiene que revisar ${turno}`, 403)
  }
}

// El certificado fisico se coordina con Academica por WhatsApp: no se cobra por
// el portal. Un monto 0 (cambio de curso con 72 h de anticipacion) tampoco.
// Un monto null SI cobra: es la reasignacion, cuyo monto se acuerda con Finanzas.
function cobraTrasAprobar (ticket, monto) {
  if (SIN_PAGO_TRAS_APROBAR.has(ticket.tipo)) return false
  if (ticket.tipo === 'CERTIFICADOS' && ticket.datos?.variante === 'FISICO') return false
  return monto !== 0
}

/**
 * Estado siguiente tras una firma. No toca la BD: devuelve a donde va el ticket
 * y el repositorio lo guarda.
 *
 * @param {object} ticket
 * @param {{ monto?: number|null }} [firma] Academica puede fijar el monto cuando
 *   Nexus lo dejo "por confirmar" (curso sin fila en la lista de precios).
 * @returns {{ status: string, area_actual: string|null, monto: number|null }}
 */
export function avanzar (ticket, { monto } = {}) {
  const montoFinal = monto ?? ticket.monto ?? null
  if (turnoDe(ticket) === AREA.ACADEMICA && cobraTrasAprobar(ticket, montoFinal)) {
    return { status: ESTADO.PENDIENTE_PAGO, area_actual: null, monto: montoFinal }
  }
  return { status: ESTADO.RESUELTA, area_actual: null, monto: montoFinal }
}

// Rechazar corta el flujo en cualquier paso. Si lo que se rechaza es el voucher,
// el tramite ya estaba aprobado: el alumno ve "pago rechazado", no "solicitud
// rechazada", porque el siguiente paso es hablar con Finanzas.
export function rechazar (ticket) {
  const status = ticket.status === ESTADO.PAGO_REGISTRADO ? ESTADO.PAGO_RECHAZADO : ESTADO.RECHAZADA
  return { status, area_actual: null }
}

export const ACCION = {
  REPROGRAMAR: 'REPROGRAMAR',
  CAMBIAR_CURSO: 'CAMBIAR_CURSO',
  MANUAL: 'MANUAL'
}

/**
 * Que mover en FICO cuando el tramite queda resuelto. null = nada que mover.
 *
 * reprogramEdition y courseChange operan sobre la VENTA (la matricula
 * top-level): crean una matricula nueva y marcan la vieja RP/CC. Mover asi un
 * modulo suelto de un diplomado lo desprenderia del paquete, por eso ese caso
 * queda MANUAL para que Academica lo resuelva en FICO.
 *
 * @returns {{ accion: string, enrollmentId?: number, destEditionId?: number, destProgramVersionId?: number, motivo?: string }|null}
 */
export function planDeEjecucion (ticket) {
  const datos = ticket.datos || {}
  if (ticket.tipo === 'REPROGRAMACION') {
    if (datos.alcance === 'PROGRAMA') {
      return { accion: ACCION.REPROGRAMAR, enrollmentId: datos.parentEnrollmentId, destEditionId: datos.destEditionId }
    }
    if (ticket.parent_enrollment_id) {
      return { accion: ACCION.MANUAL, motivo: 'Reprogramar un solo modulo de un programa se hace a mano en FICO' }
    }
    return { accion: ACCION.REPROGRAMAR, enrollmentId: ticket.enrollment_id, destEditionId: datos.destEditionId }
  }
  if (ticket.tipo === 'CAMBIO_CURSO') {
    if (ticket.parent_enrollment_id) {
      return { accion: ACCION.MANUAL, motivo: 'Cambiar un modulo de un programa se hace a mano en FICO' }
    }
    return {
      accion: ACCION.CAMBIAR_CURSO,
      enrollmentId: ticket.enrollment_id,
      destEditionId: datos.destEditionId,
      destProgramVersionId: datos.destProgramVersionId
    }
  }
  return null
}
