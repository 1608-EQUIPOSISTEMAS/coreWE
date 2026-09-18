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

// Ancho del thumbnail de Drive. 400px alcanza para la ficha y para un avatar en
// una tabla; pedir el original haria que cada listado bajase megas de PNG.
const ANCHO_FOTO = 400

// Drive entrega links de VISTA (/file/d/<id>/view, /open?id=, /uc?id=) que
// devuelven una pagina HTML, no la imagen: puestos en un <img src> salen rotos.
// El unico formato que renderiza sin sesion de Google es /thumbnail?id=.
// Cualquier otra URL (subida a /uploads, CDN) pasa intacta.
const ID_DE_DRIVE = [
  /\/file\/d\/([A-Za-z0-9_-]+)/,
  /[?&]id=([A-Za-z0-9_-]+)/,
  /\/d\/([A-Za-z0-9_-]+)/
]

export function normalizePhotoUrl (url) {
  const limpia = typeof url === 'string' ? url.trim() : ''
  if (!limpia) return null
  if (!limpia.includes('drive.google.com') && !limpia.includes('docs.google.com')) return limpia

  const id = ID_DE_DRIVE.reduce((hallado, patron) => hallado ?? limpia.match(patron)?.[1], null)
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${ANCHO_FOTO}` : limpia
}
