// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.

// Listado paginado generico (lead list, program version list, edition list).
export const toPaginatedDto = ({ rows, page, size }) => ({
  total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
  page: Number(page),
  size: Number(size),
  items: rows
})
