import { ForbiddenError } from '../../shared/errors.js'

// Reglas puras de la Auditoría del sistema. Sin I/O: todo lo de aquí se testea
// sin BD ni HTTP.

// Lo que aparece en la bitacora, con su etiqueta para la vista.
//
// Dos origenes distintos: las tablas con trigger fn_audit_changes, y las que
// el codigo inserta a mano porque no son un cambio de fila auditable
// ('logins', desde auth.repository) o porque el diff se arma en la aplicacion
// ('edition_session_control', desde edition.repository.sessionControlSave).
//
// Se enumeran a mano a proposito: un SELECT DISTINCT table_name sobre medio
// millon de filas es un seq scan, y la lista solo cambia cuando alguien agrega
// un trigger o un INSERT a audit_logs. Agregar una entrada aqui la habilita
// tambien en el filtro del formulario (audit.schemas.js lee estas claves).
export const AUDITED_TABLES = {
  enrollments: 'Inscripciones',
  payments: 'Pagos',
  leads: 'Consultas',
  lead_contact_attempts: 'Intentos de contacto',
  program_editions: 'Ediciones y cronograma',
  edition_session_control: 'Control de sesiones',
  logins: 'Accesos al sistema',
  system_actions: 'Acciones del sistema'
}

// Acciones del menú de usuario (cabecera) que no cambian ninguna fila y por eso
// ningún trigger las ve: cerrar sesión, actualizar la base del asesor, los dos
// envíos a Google Sheets y el refresco del catálogo. Las reporta el frontend
// contra /audit/action y esta es la lista blanca que impide que ese endpoint
// escriba texto libre en la bitácora.
//
// Solo los códigos: la etiqueta en español de cada acción vive en la vista
// (Auditoria.vue), junto a la de INSERT/UPDATE/DELETE/LOGIN, para no tener el
// mismo texto en dos repos.
export const SYSTEM_ACTIONS = [
  'LOGOUT', 'UPDATE_BASE', 'SYNC_PROSPECTOS', 'SYNC_PLANEAMIENTO', 'CATALOG_REFRESH',
  'SYNC_FICO'
]

export const AUDITED_ACTIONS = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN', ...SYSTEM_ACTIONS]

// Cada líder audita a su propia área: LIDER_COMERCIAL ve lo que hicieron los
// usuarios COMERCIAL (y los demás líderes comerciales, para que un equipo con
// dos jefes se vea completo). El resto de roles no entra a la vista.
//
// Se exporta porque es el organigrama del ERP, no un detalle de la Auditoría:
// el panel de equipo (dashboard.entity) decide con esta misma tabla a quién ve
// cada líder. Duplicarla allá significaría que un cambio de organigrama tenga
// que recordarse en dos archivos.
export const AREA_OF_LEADER = {
  LIDER_COMERCIAL: ['COMERCIAL', 'LIDER_COMERCIAL'],
  LIDER_FICO: ['FICO', 'LIDER_FICO'],
  LIDER_ACADEMICA: ['ACADEMICA', 'LIDER_ACADEMICA'],
  LIDER_PRODUCTO: ['PRODUCTO', 'LIDER_PRODUCTO'],
  LIDER_FUNDACION: ['FUNDACION', 'LIDER_FUNDACION'],
  LIDER_B2B: ['B2B', 'LIDER_B2B']
}

// Nombre legible de cada area del organigrama. Vive junto a AREA_OF_LEADER por
// la misma razon: es el mismo mapa (rol -> area), no un detalle de quien lo usa.
// Dashboard lo usa para el nombre del area en el panel de lider; Tickets, para
// mostrar de que area es cada ticket.
export const AREA_LABEL = {
  COMERCIAL: 'Comercial',
  FICO: 'FICO',
  ACADEMICA: 'Académica',
  PRODUCTO: 'Producto',
  FUNDACION: 'Fundación',
  B2B: 'B2B'
}

// A que area pertenece un conjunto de roles (los de un lider o los de quien
// creo un ticket). find(Boolean) y no un Set: si alguien tiene mas de un rol de
// area, se queda con el primero que matchea, no con "varias areas" a la vez.
export function areaLabelOf (roles = [], fallback = null) {
  return (roles || []).map(r => AREA_LABEL[r.replace(/^LIDER_/, '')]).find(Boolean) ?? fallback
}

// Nombre legible de UN rol puntual (a diferencia de areaLabelOf, que colapsa
// un lider y su base en la misma area). LIDER_COMERCIAL -> "Líder Comercial",
// COMERCIAL -> "Comercial", ADMIN -> "Administrador".
export function roleLabelOf (role) {
  if (!role) return null
  if (role === 'ADMIN') return 'Administrador'
  const esLider = role.startsWith('LIDER_')
  const base = esLider ? role.slice('LIDER_'.length) : role
  const nombreBase = AREA_LABEL[base] ?? base
  return esLider ? `Líder ${nombreBase}` : nombreBase
}

// Devuelve los alias de rol cuyos movimientos puede ver quien consulta.
// null = sin filtro (ADMIN lo ve todo). Lanza 403 a cualquier otro rol.
export function auditableRolesFor (roles = []) {
  if (roles.includes('ADMIN')) return null

  const areas = roles.flatMap(role => AREA_OF_LEADER[role] || [])
  if (!areas.length) {
    throw new ForbiddenError('La auditoría es solo para ADMIN y roles de liderazgo.')
  }
  return [...new Set(areas)]
}

// Normaliza los filtros del formulario. Un valor fuera del catálogo se descarta
// en vez de llegar a la query: evita que la vista pida tablas sin trigger y
// devuelva siempre vacío sin explicar por qué.
export function normalizeFilters (body = {}) {
  const page = Math.max(1, Number(body.page) || 1)
  const pageSize = Math.min(200, Math.max(10, Number(body.page_size) || 50))

  return {
    tableName: AUDITED_TABLES[body.table_name] ? body.table_name : null,
    action: AUDITED_ACTIONS.includes(body.action) ? body.action : null,
    userId: Number.isInteger(body.user_id_filter) ? body.user_id_filter : null,
    recordId: Number.isInteger(body.record_id) ? body.record_id : null,
    dateFrom: body.date_from || null,
    dateTo: body.date_to || null,
    limit: pageSize,
    offset: (page - 1) * pageSize
  }
}
