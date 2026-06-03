// Reglas puras del dominio program. Sin BD, Odoo, Slack ni red.

// Normaliza el filtro 'active' al dominio del SP ('Y' | 'N' | null).
// Semantica del listado: booleano -> Y/N, string -> tal cual, resto -> null.
export function normalizeActive (active) {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string') return active
  return null
}

// Variante para el caller: por defecto 'Y'; booleano -> Y/N y deja pasar
// el resto de valores sin transformar.
export function normalizeActiveForCaller (active = 'Y') {
  if (typeof active === 'boolean') return active ? 'Y' : 'N'
  return active
}

// Primer caracter de la entrada, usado por priceList antes de invocar al SP.
export function sliceCharacter (character) {
  if (character === null || character === undefined) return null
  if (typeof character === 'string') return character.slice(0, 1)
  return String(character).slice(0, 1)
}

// Fusiona el user_id dentro del objeto program para que el SP lo consuma.
export function buildProgramPayload (program = {}, user_id = null) {
  return { ...program, user_id }
}

// Lectura de total_count del primer row y casteo de la paginacion a Number.
export function extractPaginationMeta (rows, page, size) {
  return {
    total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
    page: Number(page),
    size: Number(size)
  }
}
