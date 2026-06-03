// Reglas puras del dominio corporate_agreement (convenios B2B). Sin BD ni red.

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
