// Forma de salida hacia el cliente. Mantiene paridad con las rutas legacy.

// Notificacion individual expuesta a la campanita.
export const toNotificationDto = (row = {}) => ({
  notification_id: row.notification_id ?? null,
  lead_id: row.lead_id ?? null,
  title: row.title ?? null,
  message: row.message ?? null,
  is_read: row.is_read ?? false,
  read_at: row.read_at ?? null,
  created_at: row.created_at ?? null
})

// Payload del listado paginado: filas crudas del SP mas el total acumulado.
export const toListDto = (rows = []) => ({
  rows,
  total_count: rows?.[0]?.total_count ?? 0
})
