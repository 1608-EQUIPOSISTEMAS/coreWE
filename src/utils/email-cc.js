// Parsea un string o array de copias (CC) y devuelve solo los emails con formato basico.
// Acepta separadores coma y punto y coma. Los invalidos se descartan en silencio
// porque el frontend valida primero; este parser es defensa en profundidad.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// CC en cascada: el parametro explicito manda solo si trae algo usable; si no,
// gana el guardado en enrollments.email_cc. Un cc:'' o cc:[] del caller NO debe
// borrar el CC del enrollment (antes lo hacia: '' no es null).
export function resolveCc (explicit, stored) {
  const list = parseEmailCc(explicit)
  return list.length > 0 ? list : parseEmailCc(stored)
}

export function parseEmailCc (raw) {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map(e => String(e).trim()).filter(e => EMAIL_RE.test(e))
  }
  return String(raw)
    .split(/[,;]/)
    .map(e => e.trim())
    .filter(e => EMAIL_RE.test(e))
}
