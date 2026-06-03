// Reglas puras del dominio bot. Sin BD, red ni reloj oculto.

// Normaliza los filtros del dashboard a la forma que espera el SP,
// coercionando ausencias a null.
export function buildDashboardFilters (payload = {}) {
  return {
    from_date: payload.from_date || null,
    to_date: payload.to_date || null
  }
}

// Determina quien resuelve un ticket: prioriza el usuario logueado
// y cae al user_id del cuerpo de la peticion.
export function resolveResolvedBy ({ current_user_id, user_id } = {}) {
  return current_user_id ?? user_id ?? null
}

// Construye el payload JSONB de actualizacion de ticket que consume el SP.
export function buildTicketUpdatePayload ({ status, notes, assigned_to, user_id, current_user_id } = {}) {
  return {
    status,
    notes,
    assigned_to: assigned_to ?? null,
    resolved_by: resolveResolvedBy({ current_user_id, user_id })
  }
}
