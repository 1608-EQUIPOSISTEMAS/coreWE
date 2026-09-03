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
  logins: 'Accesos al sistema'
}

export const AUDITED_ACTIONS = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN']

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
