import { auditRepository } from './audit.repository.js'
import { auditableRolesFor, normalizeFilters, AUDITED_TABLES } from './audit.entity.js'
import { labelForField, referenceForField, formatFieldValue } from './audit.fields.js'

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
  const page = hasMore ? rows.slice(0, filters.limit) : rows

  // Los ids de toda la página se traducen de una sola vez, antes de armar los
  // DTOs: así el mapeo de abajo queda sincrónico y sin I/O escondido.
  const labels = await repo.resolveReferences(collectReferences(page))

  return {
    rows: page.map(row => toLogDto(row, labels)),
    users,
    tables: AUDITED_TABLES,
    has_more: hasMore,
    scope: auditableRoles
  }
}

// Junta, por tipo de referencia, todos los ids que aparecen en los diffs.
function collectReferences (rows) {
  const buckets = {}

  for (const { changed_fields: changed } of rows) {
    for (const [field, diff] of entriesOf(changed)) {
      const kind = referenceForField(field)
      if (!kind) continue

      const bucket = buckets[kind] ||= new Set()
      for (const value of [diff?.old, diff?.new]) {
        if (Number.isInteger(value)) bucket.add(value)
      }
    }
  }

  return Object.fromEntries(Object.entries(buckets).map(([kind, ids]) => [kind, [...ids]]))
}

function toLogDto (row, labels) {
  return {
    id: String(row.id),
    created_at: row.created_at,
    table_name: row.table_name,
    table_label: AUDITED_TABLES[row.table_name] || row.table_name,
    record_id: row.record_id,
    action: row.action,
    user_id: row.user_id,
    user_alias: row.user_alias || (row.user_id ? `#${row.user_id}` : 'sistema'),
    changes: toChangeList(row.changed_fields, labels)
  }
}

function entriesOf (changedFields) {
  if (!changedFields || typeof changedFields !== 'object') return []
  return Object.entries(changedFields)
}

// changed_fields llega como { columna: { old, new } } con los valores crudos de
// la BD. Se aplana a una lista ya traducida —etiqueta en español y valores con
// nombre en vez de id— para que la vista solo renderice.
function toChangeList (changedFields, labels) {
  return entriesOf(changedFields)
    .map(([field, diff]) => ({
      field,
      label: labelForField(field),
      old: resolveValue(field, diff?.old ?? null, labels),
      new: resolveValue(field, diff?.new ?? null, labels)
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

function resolveValue (field, value, labels) {
  const kind = referenceForField(field)
  return formatFieldValue(field, value, kind ? labels.get(`${kind}:${value}`) : null)
}
