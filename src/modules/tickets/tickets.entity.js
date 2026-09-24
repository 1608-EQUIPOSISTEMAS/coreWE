import { AREA_OF_LEADER, areaLabelOf, roleLabelOf } from '../../shared/organigrama.js'
import { calcularSla, sumarMinutosHabiles, estadosEnRiesgo } from '../../shared/sla/sla-clock.js'
import { DomainError, ForbiddenError } from '../../shared/errors.js'

// Reglas puras del dominio tickets. Sin BD, sin disco y sin Slack: todo entra
// por parametro y todo es determinista, asi que se testea entero sin levantar nada.

export const ESTADOS = ['ABIERTO', 'EN_PROGRESO', 'CERRADO']
export const ESTADOS_ACTIVOS = ['ABIERTO', 'EN_PROGRESO']

// Casi irreversible: la unica vuelta atras permitida es reabrir un CERRADO,
// para cuando quien reporto avisa que el problema sigue. Saltar directo a
// CERRADO sin haberlo tomado se sigue rechazando.
export const TRANSICIONES_VALIDAS = {
  ABIERTO: ['EN_PROGRESO'],
  EN_PROGRESO: ['CERRADO'],
  CERRADO: ['EN_PROGRESO']
}

const TITULO_MIN = 3
const TITULO_MAX = 120
const PROBLEMA_MIN = 10
const PROBLEMA_MAX = 2000
const LINK_MAX = 2048
export const COMENTARIO_MAX = 2000

/** El numero visible del ticket. El id ES el correlativo; esto solo lo viste. */
export function formatTicketCode (ticketId) {
  return String(ticketId ?? '').padStart(5, '0')
}

// ── Alcance de lectura ─────────────────────────────────────────────────────
//
// Sustituye el catalogo de permisos del sistema origen (ticket:leer:todos,
// dashboard:leer...) por los roles del ERP:
//
//   ADMIN     -> todos los tickets, y es el unico que los gestiona
//   GERENCIA  -> todos los tickets, en solo lectura
//   LIDER_X   -> los que reporto cualquiera de su area
//   resto     -> solo los que creo el mismo
//
// El area de un ticket no se guarda: se deriva del rol de quien lo creo, igual
// que hace el dashboard. Asi mover a alguien de area no obliga a reescribir su
// historial de tickets.
export function ticketScopeFor ({ roles = [], userId = null } = {}) {
  if (roles.includes('ADMIN')) {
    return { kind: 'ALL', areaRoles: null, userId: null, canManage: true, area: 'Todos los tickets' }
  }
  if (roles.includes('GERENCIA')) {
    return { kind: 'ALL', areaRoles: null, userId: null, canManage: false, area: 'Todos los tickets' }
  }

  // Un lider de dos areas ve las dos: son los tickets por los que responde.
  const areaRoles = [...new Set(roles.filter(r => Object.hasOwn(AREA_OF_LEADER, r)).flatMap(r => AREA_OF_LEADER[r]))]
  if (areaRoles.length) {
    return { kind: 'AREA', areaRoles, userId: null, canManage: false, area: 'Tickets de mi área' }
  }

  return { kind: 'OWN', areaRoles: null, userId, canManage: false, area: 'Mis tickets' }
}

// El area de ESTE ticket (para mostrarla en la fila y en el aviso de Slack), a
// diferencia de ticketScopeFor que es el area de QUIEN CONSULTA. Misma regla
// (rol del creador -> area), aplicada a un ticket en vez de a un usuario.
export function ticketAreaLabel (creadorRoles = []) {
  return areaLabelOf(creadorRoles, 'Sin área')
}

// El rol de quien creo el ticket, sin colapsar lider y base en la misma area
// (a diferencia de ticketAreaLabel): la columna "Área" del listado en realidad
// quiere distinguir "Líder Comercial" de "Comercial", no solo el area comun.
export function ticketRoleLabel (creadorRoles = []) {
  return roleLabelOf(creadorRoles?.[0]) ?? 'Sin rol'
}

// ¿Puede este usuario abrir ESTE ticket? El listado ya filtra por alcance, pero
// el detalle, los comentarios y la descarga de adjuntos entran por id, asi que
// cada uno vuelve a preguntar.
export function canRead (ticket, scope, userId) {
  if (!ticket) return false
  if (scope.kind === 'ALL') return true
  if (ticket.created_by_id === userId) return true
  if (ticket.assigned_to_id === userId) return true
  if (scope.kind === 'AREA') {
    return (ticket.creador_roles || []).some(rol => scope.areaRoles.includes(rol))
  }
  return false
}

export function assertCanRead (ticket, scope, userId) {
  if (!canRead(ticket, scope, userId)) {
    throw new ForbiddenError('No tienes permiso sobre este ticket')
  }
  return ticket
}

// Comentar tiene el mismo alcance que leer: si lo ves, participas del hilo.
export const assertCanComment = assertCanRead

export function assertCanManage (scope) {
  if (!scope.canManage) throw new ForbiddenError('Solo un administrador puede gestionar tickets')
  return scope
}

// Un ABIERTO sin dueño lo puede tomar cualquier agente (es la ventana de gracia
// antes del reparto automatico): tomarlo lo asigna a quien lo tomo.
export function isTakeable (ticket) {
  return ticket?.status === 'ABIERTO' && ticket.assigned_to_id == null
}

// ¿Puede ESTE usuario mover el estado de ESTE ticket? Mismo criterio que
// nextStatus, calculado para que el front decida que botones mostrar.
export function canChangeStatusOf (ticket, scope, userId) {
  if (!scope.canManage || !ticket) return false
  return ticket.assigned_to_id === userId || isTakeable(ticket)
}

// ¿Puede quien REPORTO reabrir su propio ticket? Si el problema sigue, no
// depende de que el agente lea un comentario: lo reabre y el ticket vuelve a
// la cola de quien lo atendia. Solo su ticket y solo si esta CERRADO.
export function canReopenOf (ticket, userId) {
  return Boolean(ticket) && ticket.status === 'CERRADO' && ticket.created_by_id === userId
}

// Campos a actualizar al reabrir desde quien reporto. Mismo efecto que el
// reabrir del agente en nextStatus: la resolucion anterior deja de valer y la
// primera respuesta se conserva.
export function reopenByReporter (ticket, userId) {
  if (!ticket || ticket.created_by_id !== userId) {
    throw new ForbiddenError('Solo quien reportó el ticket puede reabrirlo')
  }
  if (ticket.status !== 'CERRADO') {
    throw new DomainError('Solo se puede reabrir un ticket resuelto')
  }
  return { status: 'EN_PROGRESO', first_response_at: ticket.first_response_at, resolved_at: null }
}

// ── Transiciones ───────────────────────────────────────────────────────────
//
// Devuelve los campos a actualizar, no toca la BD. Sella los relojes: al tomar
// el ticket queda la primera respuesta; al resolverlo, la resolucion.
export function nextStatus (ticket, agentId, nuevoEstado, ahora = new Date()) {
  // Ownership: ser ADMIN no alcanza, hay que ser el agente asignado. Si no,
  // dos administradores se pisarian el trabajo del otro.
  if (ticket.assigned_to_id !== agentId) {
    throw new ForbiddenError('No tienes permiso sobre este ticket')
  }

  const permitidas = TRANSICIONES_VALIDAS[ticket.status] ?? []
  if (!permitidas.includes(nuevoEstado)) {
    throw new DomainError(`No se puede pasar de ${ticket.status} a ${nuevoEstado}`)
  }

  // Reabrir (CERRADO -> EN_PROGRESO): la resolucion anterior ya no vale, asi
  // que resolved_at se destraba a null. first_response_at no se toca: la
  // primera respuesta ya paso y reabrir no la borra.
  if (ticket.status === 'CERRADO' && nuevoEstado === 'EN_PROGRESO') {
    return { status: nuevoEstado, first_response_at: ticket.first_response_at, resolved_at: null }
  }

  // El ?? no pisa una marca existente. Hoy TRANSICIONES_VALIDAS ya impide
  // llegar dos veces (salvo el reabrir de arriba), pero la regla queda escrita
  // donde importa.
  return nuevoEstado === 'EN_PROGRESO'
    ? { status: nuevoEstado, first_response_at: ticket.first_response_at ?? ahora }
    : { status: nuevoEstado, first_response_at: ticket.first_response_at ?? ahora, resolved_at: ahora }
}

// ── Reparto automatico ─────────────────────────────────────────────────────
//
// Entre los candidatos (usuarios ADMIN activos, que los trae el repositorio),
// elige a quien no tenga nada EN_PROGRESO; a igualdad, al de menor carga
// activa; y a igualdad, al que hace mas tiempo no recibe un ticket.
//
// excluirId lo usa el escalamiento del SLA: "el disponible que no sea el que ya
// lo tiene", para no reasignarle el ticket a la misma persona.
export function pickAgent (candidatos = [], excluirId = null) {
  const elegibles = candidatos
    .filter(c => c.user_id !== excluirId)
    .map(c => ({
      user_id: c.user_id,
      enProgreso: Boolean(c.en_progreso),
      cargaActiva: Number(c.carga_activa ?? 0),
      ultimoAsignado: c.ultimo_asignado ? new Date(c.ultimo_asignado).getTime() : 0
    }))

  if (!elegibles.length) return null

  elegibles.sort((a, b) => {
    if (a.enProgreso !== b.enProgreso) return a.enProgreso ? 1 : -1
    if (a.cargaActiva !== b.cargaActiva) return a.cargaActiva - b.cargaActiva
    return a.ultimoAsignado - b.ultimoAsignado
  })

  return elegibles[0].user_id
}

// Reasignacion manual. A diferencia del reparto automatico no elige por carga
// (quien la pide ya decidio a quien), pero sostiene las mismas invariantes.
export function assertReassignable (ticket, destino, nuevoAsignadoId) {
  if (ticket.status === 'CERRADO') {
    throw new DomainError('No se puede reasignar un ticket cerrado')
  }
  if (ticket.assigned_to_id === nuevoAsignadoId) {
    throw new DomainError('El ticket ya está asignado a ese usuario')
  }
  if (!destino || destino.active !== 'Y' || !destino.es_agente) {
    throw new DomainError('Ese usuario no puede recibir tickets')
  }
  // Mismo criterio de "activos" que el reparto automatico: no se le carga mas
  // trabajo a mano a quien ya tiene un ABIERTO o un EN_PROGRESO.
  if (Number(destino.carga_activa ?? 0) > 0) {
    throw new DomainError('Ese usuario ya tiene tickets activos asignados')
  }
  return true
}

// ── Validacion de entrada ──────────────────────────────────────────────────
//
// Vive aca y no en un schema de Fastify porque las rutas que crean ticket y
// comentario son multipart: declararles schema.body haria que AJV vaciara el
// body. Ademas la comparte el bot de Slack por DM, que no pasa por AJV.
export function validateTicketInput ({ titulo, problema, link } = {}) {
  const t = String(titulo ?? '').trim()
  const p = String(problema ?? '').trim()
  if (t.length < TITULO_MIN || t.length > TITULO_MAX) {
    throw new DomainError(`El título debe tener entre ${TITULO_MIN} y ${TITULO_MAX} caracteres`)
  }
  if (p.length < PROBLEMA_MIN || p.length > PROBLEMA_MAX) {
    throw new DomainError(`La problemática debe tener entre ${PROBLEMA_MIN} y ${PROBLEMA_MAX} caracteres`)
  }

  return { titulo: t, problema: p, link: normalizarEnlaces(link) }
}

/**
 * Uno o varios enlaces de referencia, guardados en la misma columna separados
 * por salto de linea. NO se valida que sean URLs: rechazar un enlace que el
 * usuario sabe que funciona (el caso de Slack, que devuelve `<url|etiqueta>`)
 * costaba mas que lo que protegia. El XSS se evita al pintar: el front solo
 * arma <a href> con http(s) (hrefSeguro) y el resto lo muestra como texto.
 *
 * Acepta texto (separado por espacios o saltos) o un arreglo. Quita el
 * envoltorio de Slack (`<url>`, `<url|etiqueta>`) y los repetidos.
 */
export function normalizarEnlaces (entrada) {
  const crudos = Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/\s+/)
  const enlaces = []
  for (const crudo of crudos) {
    const e = String(crudo ?? '').trim().replace(/^<([^<>|]+)(?:\|[^<>]*)?>$/, '$1').trim()
    if (e && !enlaces.includes(e)) enlaces.push(e)
  }
  if (!enlaces.length) return null
  const unidos = enlaces.join('\n')
  if (unidos.length > LINK_MAX) throw new DomainError('Los enlaces son demasiado largos')
  return unidos
}

/** Inverso de normalizarEnlaces: la columna como lista. */
export function separarEnlaces (link) {
  return String(link ?? '').split('\n').map(e => e.trim()).filter(Boolean)
}

export function validateComment (cuerpo) {
  const c = String(cuerpo ?? '').trim()
  if (!c || c.length > COMENTARIO_MAX) {
    throw new DomainError(`El comentario debe tener entre 1 y ${COMENTARIO_MAX} caracteres`)
  }
  return c
}

/**
 * Congela los vencimientos con los plazos de criterios-prioridad.md (minutos
 * HABILES: solo corren lun-vie 09:00-18:00 Lima). Se pasa createdAt explicito
 * (y no se deja el default de la BD) para que ambos relojes cuenten desde
 * exactamente el mismo instante que queda guardado en la fila.
 */
export function computeDueDates (policy, createdAt) {
  if (!policy) return { first_response_due_at: null, resolution_due_at: null }
  return {
    first_response_due_at: sumarMinutosHabiles(createdAt, policy.first_response_minutes),
    resolution_due_at: sumarMinutosHabiles(createdAt, policy.resolution_minutes)
  }
}

// ── Presentacion ───────────────────────────────────────────────────────────

/** Adjunta a la fila el codigo visible y los dos relojes ya evaluados. */
export function withSla (row, ahora = new Date()) {
  if (!row) return row
  const sla = calcularSla(row, ahora)
  return { ...row, codigo: formatTicketCode(row.ticket_id), sla, riesgo: estadosEnRiesgo(sla) }
}

export const FILTROS = ['TODOS', 'MIOS', 'SIN_ASIGNAR', 'POR_VENCER', 'VENCIDOS']

/**
 * Filtro y orden de la bandeja, en JS y no en SQL: POR_VENCER depende del
 * umbral de sla-clock y reimplementarlo en la consulta duplicaria la regla.
 */
export function applyFilter (tickets = [], filtro = 'TODOS', userId = null) {
  switch (filtro) {
    case 'MIOS': return tickets.filter(t => t.assigned_to_id === userId)
    case 'SIN_ASIGNAR': return tickets.filter(t => !t.assigned_to_id)
    case 'POR_VENCER': return tickets.filter(t => t.riesgo.porVencer && !t.riesgo.vencido)
    case 'VENCIDOS': return tickets.filter(t => t.riesgo.vencido)
    default: return tickets
  }
}

/** Los numeros de la cabecera de la bandeja, uno por cada chip de filtro. */
export function buildKpis (tickets = [], userId = null) {
  return {
    total: tickets.length,
    misAsignados: tickets.filter(t => t.assigned_to_id === userId && ESTADOS_ACTIVOS.includes(t.status)).length,
    sinAsignar: tickets.filter(t => !t.assigned_to_id).length,
    // Sin chip: los que todavia puede repartir tickets-autoassign (mismo
    // criterio que unassignedOlderThan). El front refresca mientras sea > 0.
    porAsignar: tickets.filter(t => !t.assigned_to_id && t.status === 'ABIERTO').length,
    // Mismo criterio que applyFilter('POR_VENCER'): por vencer y no vencido, para
    // que un ticket no cuente en los dos chips a la vez.
    porVencer: tickets.filter(t => t.riesgo.porVencer && !t.riesgo.vencido).length,
    vencidos: tickets.filter(t => t.riesgo.vencido).length
  }
}
