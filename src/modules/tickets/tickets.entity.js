// Reglas puras del modulo Tickets de Alumnos. Sin I/O: se testean solas.
//
// El alumno abre el tramite desde el portal (Nexus) y este modulo lo resuelve.
// La tabla `solicitudes_portal` vive en la MISMA base que el ERP, asi que no hay
// integracion ni sincronizacion: Nexus escribe, aca se lee y se avanza.

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
  EN_PROCESO: 'EN_PROCESO',
  RESUELTA: 'RESUELTA',
  RECHAZADA: 'RECHAZADA'
}

export const AREA = {
  ACADEMICA: 'ACADEMICA',
  FICO: 'FICO'
}

// Quien firma cada tramite, en orden. Es el acuerdo del acta del 17/09/26:
// Academica confirma que el pedido corresponde y FICO valida el pago; cuando el
// ultimo paso firma, el tramite queda resuelto.
//
// Es una tabla de datos y no siete maquinas de estado porque los siete tramites
// recorren solo tres caminos: agregar un tramite nuevo es una linea aca.
const PASOS = {
  REPROGRAMACION: [AREA.ACADEMICA, AREA.FICO],
  CAMBIO_CURSO: [AREA.ACADEMICA, AREA.FICO],
  ALQUILER_SAP: [AREA.FICO],
  COMPRA_GRABACIONES: [AREA.ACADEMICA, AREA.FICO],
  CERTIFICADOS: [AREA.ACADEMICA, AREA.FICO],
  FLEXIBILIDAD_HORARIA: [AREA.ACADEMICA],
  REASIGNACION_CURSO: [AREA.ACADEMICA, AREA.FICO],
  // Tipo retirado del portal: ya no se crean, pero quedaron tickets abiertos y
  // sin una ruta aca nadie podria cerrarlos.
  CAMBIO_FLEX: [AREA.ACADEMICA]
}

const TERMINALES = [ESTADO.RESUELTA, ESTADO.RECHAZADA]

// Un tipo que este modulo no conoce todavia (Nexus agrego uno y el ERP no se
// actualizo) cae en Academica en vez de quedarse sin dueno: un ticket que nadie
// ve es peor que uno mal ruteado.
export function pasosDe (tipo) {
  return PASOS[tipo] ?? [AREA.ACADEMICA]
}

export function areaInicial (tipo) {
  return pasosDe(tipo)[0]
}

/** El area que sigue despues de `area`, o null si era la ultima firma. */
export function siguienteArea (tipo, area) {
  const pasos = pasosDe(tipo)
  return pasos[pasos.indexOf(area) + 1] ?? null
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
  const turno = ticket.area_actual || areaInicial(ticket.tipo)
  if (!areas.includes(turno)) {
    throw new TicketError(`Este tramite lo tiene que revisar ${turno}`, 403)
  }
}

/**
 * Estado siguiente tras una firma. No toca la BD: devuelve a donde va el ticket
 * y el repositorio lo guarda.
 *
 * @returns {{ status: string, area_actual: string|null }}
 */
export function avanzar (ticket) {
  const turno = ticket.area_actual || areaInicial(ticket.tipo)
  const siguiente = siguienteArea(ticket.tipo, turno)
  return siguiente
    ? { status: ESTADO.EN_PROCESO, area_actual: siguiente }
    : { status: ESTADO.RESUELTA, area_actual: null }
}

// Rechazar corta el flujo en cualquier paso: si Academica dice que no, no tiene
// sentido que FICO revise el pago.
export function rechazar () {
  return { status: ESTADO.RECHAZADA, area_actual: null }
}
