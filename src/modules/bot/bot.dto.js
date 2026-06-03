// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.

// Resultado paginado: extrae total_count del primer row del SP.
export const toPaginatedDto = ({ rows, page, size }) => ({
  total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
  page: Number(page),
  size: Number(size),
  items: rows
})

// Primer row del SP envuelto en { data }.
export const toSingleDto = ({ rows }) => ({
  data: rows?.[0] || {}
})

// Confirmacion de actualizacion de ticket.
export const toTicketUpdateDto = ({ id }) => ({
  success: true,
  ticket_id: id
})

// Listado simple sin paginacion (asesores asignables).
export const toItemsDto = ({ rows }) => ({
  items: rows
})
