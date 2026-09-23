import { ForbiddenError } from '../../shared/errors.js'
import { AREA_OF_LEADER } from '../../shared/organigrama.js'

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

// El organigrama (AREA_OF_LEADER, AREA_LABEL, areaLabelOf, roleLabelOf) vivia
// aca, pero lo usan tambien Dashboard y Tickets y no es de ninguno de los tres:
// ahora es shared/organigrama. Se reexporta porque la Auditoria es su consumidor
// historico y media docena de archivos de este modulo lo importan por este
// nombre; quien venga de fuera lo toma de shared, no de aca.
export { AREA_LABEL, areaLabelOf, roleLabelOf } from '../../shared/organigrama.js'
export { AREA_OF_LEADER }

// Cada líder audita a su propia área: LIDER_COMERCIAL ve lo que hicieron los
// usuarios COMERCIAL (y los demás líderes comerciales, para que un equipo con
// dos jefes se vea completo). El resto de roles no entra a la vista.
//
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
