import { ticketRoleLabel, separarEnlaces } from './tickets.entity.js'

// La BD habla snake_case; el frontend, camelCase. Este es el unico lugar que
// traduce, para que ni el repositorio invente alias ni el .vue lea columnas.

const persona = (nombre, alias) => (nombre ? { nombre, alias } : null)

/** Fila de la bandeja y cabecera del detalle. */
export function toTicketDto (t) {
  if (!t) return null
  return {
    id: t.ticket_id,
    codigo: t.codigo,
    titulo: t.title,
    problema: t.problem,
    link: t.link,
    // La columna guarda uno o varios, uno por linea.
    enlaces: separarEnlaces(t.link),
    prioridad: t.priority,
    estado: t.status,
    creadoPor: persona(t.creador, t.creador_alias),
    // La columna se llama "Área" pero en realidad muestra el rol de quien creo
    // el ticket (más específico que el área: distingue "Líder Comercial" de
    // "Comercial"). No se guarda: se deriva en cada consulta.
    area: ticketRoleLabel(t.creador_roles),
    asignadoA: persona(t.asignado, t.asignado_alias),
    creadoEn: t.registration_date,
    comentarios: t.comentarios ?? 0,
    // En el listado es un conteo; en el detalle, la lista para poder pintarlos.
    adjuntos: t.adjuntosLista ?? t.adjuntos ?? 0,
    escaladoEn: t.escalated_at,
    sla: toSlaDto(t.sla),
    riesgo: t.riesgo ?? { vencido: false, porVencer: false },
    // canManage solo en el detalle; canChangeStatus tambien por fila del listado.
    ...(t.canManage !== undefined ? { canManage: t.canManage } : {}),
    ...(t.canChangeStatus !== undefined ? { canChangeStatus: t.canChangeStatus } : {}),
    ...(t.canReopen !== undefined ? { canReopen: t.canReopen } : {}),
    // Solo al resolver: si la confirmacion le llego por Slack a quien reporto.
    ...(t.avisoSlack !== undefined && t.avisoSlack !== null ? { avisoSlack: t.avisoSlack } : {})
  }
}

// El front no recalcula nada del SLA: recibe el veredicto y los milisegundos, y
// solo anima el contador. El backend es el unico que evalua los relojes.
function toSlaDto (sla) {
  if (!sla) return null
  const reloj = r => ({ venceEn: r.venceEn, cumplidoEn: r.cumplidoEn, estado: r.estado, msRestantes: r.msRestantes })
  return { respuesta: reloj(sla.respuesta), resolucion: reloj(sla.resolucion) }
}

export function toCommentDto (c) {
  return {
    id: c.ticket_comment_id,
    cuerpo: c.body,
    autor: persona(c.autor, c.autor_alias),
    autorId: c.author_id,
    creadoEn: c.registration_date,
    adjuntos: c.adjuntos ?? []
  }
}

/** Un renglon de la pestaña "Actividad". actor null = lo hizo el sistema. */
export function toActivityDto (e) {
  return {
    id: e.id,
    tipo: e.tipo,
    fecha: e.fecha,
    actor: e.actor ?? null,
    deUsuario: e.de_usuario ?? null,
    aUsuario: e.a_usuario ?? null,
    detalle: e.detalle ?? null
  }
}

export function toAssigneeDto (u) {
  return { id: u.user_id, nombre: u.name }
}
