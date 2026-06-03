// Reglas puras del dominio catalog. Sin BD ni red.

// Parametros del SP sp_membership_list en el orden exacto que espera la BD:
// IN p_active boolean, IN p_q text, IN p_page int, IN p_size int.
// Se pasa 'active' crudo (boolean o null): el SP lo tipa como boolean.
export function buildMembershipParams ({ active, q, page, size } = {}) {
  return [
    active ?? null,
    q || null,
    page || 1,
    size || 25
  ]
}
