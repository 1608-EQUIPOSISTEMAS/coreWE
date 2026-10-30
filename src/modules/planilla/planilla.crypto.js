import crypto from 'node:crypto'
import { DomainError } from '../../shared/errors.js'

// Cifrado de sueldos (AES-256-GCM) del lado de Node. La clave vive SOLO en la
// variable de entorno PLANILLA_KEY del servidor: nunca viaja a Postgres, asi que
// ni un SELECT directo, ni un dump, ni el log de queries exponen un sueldo.
//
// PLANILLA_KEY = 32 bytes en base64 o hex. Generar con:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Si se pierde la clave, los sueldos guardados no se pueden recuperar: hay que
// volver a importarlos.

function clave () {
  const raw = process.env.PLANILLA_KEY || ''
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new DomainError('El servidor no tiene configurada la clave de planilla (PLANILLA_KEY).', { statusCode: 500, code: 'PLANILLA_KEY' })
  }
  return buf
}

// Formato guardado: v1.<iv>.<tag>.<cifrado>, todo en base64.
export function cifrarMonto (monto) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', clave(), iv)
  const enc = Buffer.concat([cipher.update(String(monto), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.')
}

export function descifrarMonto (valor) {
  if (!valor) return null
  const [v, iv, tag, enc] = String(valor).split('.')
  if (v !== 'v1') throw new DomainError('Formato de sueldo cifrado desconocido.', { statusCode: 500 })
  const decipher = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const txt = Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
  return Number(txt)
}
