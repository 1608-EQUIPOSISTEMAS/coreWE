// Mapeo de la fila de BD hacia el shape que consume el cliente. Mantener este
// borde estable evita que un cambio de columna en payment_tokens se filtre al
// frontend sin control. Hoy la lista es passthrough (paridad con el service
// legacy); endurecer a allowlist cuando el contrato con el front este fijado.

export const toTokenDto = row => row

export const toTokenListDto = ({ total, page, size, items }) => ({
  total,
  page,
  size,
  items: items.map(toTokenDto)
})

// Traduce la fila cruda de KPIs a las claves camelCase que espera el dashboard.
export const toStatsDto = row => ({
  pending: Number(row.pending_count || 0),
  awaitingConfirmation: Number(row.link_sent_count || 0),
  confirmedToday: Number(row.confirmed_today_count || 0),
  amountPen: Number(row.amount_pen || 0),
  amountUsd: Number(row.amount_usd || 0)
})
