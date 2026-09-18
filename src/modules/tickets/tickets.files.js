import { randomUUID } from 'node:crypto'
import { mkdirSync, createWriteStream } from 'node:fs'
import { unlink, stat } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { DomainError, NotFoundError } from '../../shared/errors.js'

// Adjuntos de tickets y comentarios en disco local.
//
// Dos defensas que el MIME declarado no da:
//   - el nombre en disco es un UUID, nunca el que mando el cliente (evita path
//     traversal y colisiones); el original solo viaja en el Content-Disposition
//   - se verifican los magic bytes: un .exe renombrado a .png declara
//     image/png en el multipart y pasaria cualquier chequeo de extension
//
// Los bytes se acumulan en memoria (como mucho 4 x 5 MB) y se escriben solo
// despues de validar. El sistema origen escribia primero con multer y limpiaba
// despues con un middleware; asi no hay nada que limpiar en el caso normal.

export const MIME_PERMITIDOS = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
export const MAX_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 4

const EXT_POR_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
}

export const UPLOADS_DIR = resolve(process.env.TICKETS_UPLOADS_DIR || join(process.cwd(), 'uploads', 'tickets'))
mkdirSync(UPLOADS_DIR, { recursive: true })

const FIRMAS = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'application/pdf': [0x25, 0x50, 0x44, 0x46]
}

/** Verifica los magic bytes del buffer contra el MIME declarado. */
export function firmaValida (buffer, mimeType) {
  if (mimeType === 'image/webp') {
    // RIFF....WEBP: los 4 bytes del medio son el tamano del archivo.
    return buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
  }
  const firma = FIRMAS[mimeType]
  if (!firma) return false
  if (buffer.length < firma.length) return false
  return firma.every((byte, i) => buffer[i] === byte)
}

function escribir (buffer, storedName) {
  return new Promise((resolvePromise, reject) => {
    const stream = createWriteStream(join(UPLOADS_DIR, storedName))
    stream.on('error', reject)
    stream.on('finish', resolvePromise)
    stream.end(buffer)
  })
}

/**
 * Consume el iterable de partes de @fastify/multipart y devuelve
 * { campos, archivos } con los archivos ya escritos y validados.
 *
 * Si alguna parte falla, borra las que ya se escribieron: nunca queda basura en
 * disco por un request rechazado.
 */
export async function readMultipart (req, { maxFiles = MAX_FILES } = {}) {
  const campos = {}
  const archivos = []

  try {
    for await (const parte of req.parts()) {
      if (parte.type === 'field') {
        campos[parte.fieldname] = parte.value
        continue
      }

      if (archivos.length >= maxFiles) {
        throw new DomainError(`Como máximo ${maxFiles} archivos por ticket`)
      }
      if (!MIME_PERMITIDOS.includes(parte.mimetype)) {
        throw new DomainError('Solo se permiten imágenes PNG, JPG, WEBP o archivos PDF')
      }

      const buffer = await parte.toBuffer()

      // @fastify/multipart trunca al llegar al limite global en vez de lanzar.
      if (parte.file?.truncated || buffer.length > MAX_BYTES) {
        throw new DomainError('Cada archivo debe pesar como máximo 5 MB')
      }
      if (!buffer.length) {
        throw new DomainError('Uno de los archivos llegó vacío')
      }
      if (!firmaValida(buffer, parte.mimetype)) {
        throw new DomainError(`El archivo "${parte.filename}" no es realmente un ${parte.mimetype}`)
      }

      const storedName = `${randomUUID()}${EXT_POR_MIME[parte.mimetype] ?? extname(parte.filename ?? '')}`
      await escribir(buffer, storedName)
      archivos.push({
        original_name: String(parte.filename ?? 'archivo').slice(0, 255),
        stored_name: storedName,
        mime_type: parte.mimetype,
        size_bytes: buffer.length
      })
    }
  } catch (err) {
    await removeAttachments(archivos.map(a => a.stored_name))
    throw err
  }

  return { campos, archivos }
}

/** Best-effort: si el archivo ya no esta, no hay nada que arreglar. */
export async function removeAttachments (storedNames = []) {
  await Promise.all(storedNames.map(name =>
    unlink(join(UPLOADS_DIR, name)).catch(() => {})
  ))
}

/**
 * Ruta absoluta de un adjunto. stored_name siempre lo genera este modulo, pero
 * el guard queda igual: la ruta resuelta tiene que seguir dentro de UPLOADS_DIR.
 */
export async function attachmentPath (storedName) {
  const ruta = resolve(UPLOADS_DIR, String(storedName ?? ''))
  if (!ruta.startsWith(UPLOADS_DIR)) throw new NotFoundError('Adjunto no encontrado')
  try {
    await stat(ruta)
  } catch {
    throw new NotFoundError('El archivo ya no está disponible')
  }
  return ruta
}
