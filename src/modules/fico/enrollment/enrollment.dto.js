// Borde de salida del agregado enrollment. Hoy es passthrough (paridad exacta
// con el service legacy, que devolvia las filas crudas del SP). Mantener el
// mapeo aislado aqui permite endurecerlo a allowlist sin tocar usecases cuando
// el contrato con el front quede fijado.

// Listado FICO: el SP sp_fico_enrollment_list ya entrega las filas con su shape
// final; total_count viaja en cada fila. Se conserva la forma { total, page,
// size, items } que el frontend consume.
export function toEnrollmentListDto (rows, payload = {}) {
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0
  return {
    total,
    page: Number(payload.page || 1),
    size: Number(payload.size || 25),
    items: rows
  }
}

// Detalle de pago: la fila del SP enriquecida con fechas de edicion y alias de
// estado. Passthrough.
export function toPaymentDetailDto (row) {
  return row
}
