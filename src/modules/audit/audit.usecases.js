import { auditRepository } from './audit.repository.js'
import { auditableRolesFor, normalizeFilters, AUDITED_TABLES } from './audit.entity.js'

const repo = auditRepository

// Bitácora paginada + los datos que la vista necesita para armar sus filtros.
// Todo en una llamada: la lista de usuarios es de decenas de filas y ahorrarse
// un segundo endpoint es un archivo menos que mantener.
export async function listAuditLog (roles, body) {
  const auditableRoles = auditableRolesFor(roles)
  const filters = normalizeFilters(body)

  const [rows, users] = await Promise.all([
    repo.listLogs({ ...filters, auditableRoles }),
    repo.listAuditableUsers(auditableRoles)
  ])

  // listLogs pide una fila de más para saber si hay página siguiente sin pagar
  // un COUNT(*) sobre la tabla entera.
  const hasMore = rows.length > filters.limit

  return {
    rows: (hasMore ? rows.slice(0, filters.limit) : rows).map(toLogDto),
    users,
    tables: AUDITED_TABLES,
    has_more: hasMore,
    scope: auditableRoles
  }
}

function toLogDto (row) {
  return {
    id: String(row.id),
    created_at: row.created_at,
    table_name: row.table_name,
    table_label: AUDITED_TABLES[row.table_name] || row.table_name,
    record_id: row.record_id,
    action: row.action,
    user_id: row.user_id,
    user_alias: row.user_alias || (row.user_id ? `#${row.user_id}` : 'sistema'),
    changes: toChangeList(row.changed_fields)
  }
}

// changed_fields llega como { columna: { old, new } }. Se aplana a una lista
// para que la vista no tenga que iterar un objeto con orden indefinido.
function toChangeList (changedFields) {
  if (!changedFields || typeof changedFields !== 'object') return []
  return Object.entries(changedFields)
    .map(([field, diff]) => ({ field, old: diff?.old ?? null, new: diff?.new ?? null }))
    .sort((a, b) => a.field.localeCompare(b.field))
}
