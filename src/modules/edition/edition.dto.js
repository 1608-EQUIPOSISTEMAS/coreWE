// Forma de salida hacia el cliente. Mantiene paridad exacta con el service legacy.

// register / treeUpdate: primera fila cruda del SP o el fallback estandar.
export const toSpRowOrFallback = (rows) =>
  rows?.[0] || { result: 0, message: 'No response from DB', response: null }

// list: total derivado de total_count + paginacion + items crudos.
export const toListDto = ({ rows, page, size }) => ({
  total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
  page: Number(page),
  size: Number(size),
  items: rows
})

// listByWeek: total = cantidad de filas, sobre el mismo envelope { ok, ... }.
export const toByWeekDto = ({ rows, page, size }) => ({
  ok: true,
  total: rows.length,
  page,
  size,
  items: rows
})

// update: el legacy retorna solo message y result de la primera fila.
export const toUpdateDto = (rows) => {
  const row = rows?.[0] || {}
  return {
    message: row.message,
    result: row.result
  }
}

// a5MigrationExecute: normaliza result/message/migrated_count con defaults.
export const toA5MigrationDto = (rows) => {
  const row = rows?.[0] || {}
  return {
    result: row.result ?? 0,
    message: row.message || 'Sin respuesta del SP',
    migrated_count: row.migrated_count ?? 0
  }
}
