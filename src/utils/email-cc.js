// Parsea un string o array de copias (CC) y devuelve solo los emails con formato basico.
// Acepta separadores coma y punto y coma. Los invalidos se descartan en silencio
// porque el frontend valida primero; este parser es defensa en profundidad.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
