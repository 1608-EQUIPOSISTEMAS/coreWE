// Reglas puras del dominio notification. Sin BD, red, reloj ni SSE.

// Cuenta las notificaciones no leidas de una coleccion en memoria.
export function countUnread (notifications = []) {
  return notifications.filter(n => !n.is_read).length
}

// Devuelve solo las notificaciones no leidas de una coleccion.
export function filterUnread (notifications = []) {
  return notifications.filter(n => !n.is_read)
}

// Serializa un payload al formato de evento SSE 'data: ...\n\n'.
export function buildSseEventData (payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

// Parsea el payload crudo de un NOTIFY de Postgres y castea asesor_id a numero.
export function parseNotificationPayload (raw) {
  const payload = JSON.parse(raw)
  return { ...payload, asesor_id: Number(payload.asesor_id) }
}

// Normaliza y valida la paginacion del listado: page >= 1, size acotado a [1, 100].
// El SP recibe estos filtros serializados, por eso se devuelve un objeto plano.
export function buildListFilters ({ user_id, page = 1, size = 20, is_read = undefined } = {}) {
  const normalizedPage = Math.max(1, Number(page) || 1)
  const normalizedSize = Math.min(100, Math.max(1, Number(size) || 20))
  return { user_id, page: normalizedPage, size: normalizedSize, is_read }
}
