// Reglas puras del dominio instructor. Sin BD, Odoo ni Slack.

// Password temporal entregada al instructor en su alta. Formato: <DNI>@We2026!.
export function buildTempPassword (documentNumber) {
  return `${documentNumber ?? 'doc'}@We2026!`
}

// Nombre completo a partir de los componentes, omitiendo vacios.
export function buildFullName ({ first_name, last_name, mother_last_name } = {}) {
  return [first_name, last_name, mother_last_name].filter(Boolean).join(' ').trim()
}

// Normaliza el filtro 'active' al dominio del SP ('Y' | 'N' | null).
// Semantica del listado: booleano -> Y/N, string -> tal cual, resto -> null.
export function normalizeActive (active) {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string') return active
  return null
}

// Variante del marcador para el caller: por defecto 'Y' y trata el string vacio
// como ausencia de filtro (null), a diferencia del listado general.
export function normalizeActiveForCaller (active = 'Y') {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string' && active !== '') return active
  return null
}
