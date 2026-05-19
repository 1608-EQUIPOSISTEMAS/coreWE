// src/routes/upload.js
import fs from 'fs'
import path from 'path'
import util from 'util'
import crypto from 'crypto'
import { pipeline } from 'stream'
import { authenticate } from '../middlewares/auth.hooks.js'

const pump = util.promisify(pipeline)

const SAFE_FILENAME_RE = /[^a-zA-Z0-9._-]+/g
const MAX_STEM_LENGTH = 80

function sanitizeUploadName (rawName) {
  // Elimina cualquier componente de path antes del nombre
  const base = path.basename(rawName || 'archivo')
  // Reemplaza caracteres no seguros y normaliza puntos iniciales (evita .htaccess y similares)
  const cleaned = base.replace(SAFE_FILENAME_RE, '_').replace(/^\.+/, '')
  if (!cleaned) return null
  const ext = path.extname(cleaned).toLowerCase()
  const stem = path.basename(cleaned, ext).slice(0, MAX_STEM_LENGTH)
  return `${Date.now()}_${crypto.randomUUID()}_${stem}${ext}`
}

export default async function uploadRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate)

  // Definir carpeta de destino (Usamos process.cwd() para ir a la raíz del proyecto)
  const UPLOAD_FOLDER = path.join(process.cwd(), 'uploads')

  // Asegurar que la carpeta exista
  if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER, { recursive: true })
  }

  fastify.post('/', async (req, reply) => {
    try {
      // req.file() está disponible porque ya registraste fastify-multipart en app.js
      const data = await req.file()
      
      if (!data) {
        return reply.code(400).send({ message: 'No se envió ningún archivo' })
      }

      // Validar tipo de archivo (Opcional)
      const allowedMimeTypes = [
          'image/jpeg', 
          'image/png', 
          'application/pdf', 
          'application/msword', 
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ]
      
      if (!allowedMimeTypes.includes(data.mimetype)) {
        return reply.code(400).send({ message: 'Formato no permitido. Solo PDF o Imágenes.' })
      }

      const uniqueFileName = sanitizeUploadName(data.filename)
      if (!uniqueFileName) {
        return reply.code(400).send({ message: 'Nombre de archivo inválido' })
      }
      const savePath = path.resolve(UPLOAD_FOLDER, uniqueFileName)
      // Defensa adicional: el path resuelto debe seguir dentro de UPLOAD_FOLDER
      if (!savePath.startsWith(path.resolve(UPLOAD_FOLDER) + path.sep)) {
        return reply.code(400).send({ message: 'Ruta de archivo inválida' })
      }

      // Guardar el archivo
      await pump(data.file, fs.createWriteStream(savePath))

      // Construir URL pública
      // En PROD (VPS), tu dominio debería estar en una variable de entorno, ej: PROCESS.ENV.PUBLIC_URL
      // Si no existe, usamos el protocolo y host del request
      const protocol = req.protocol
      const host = req.headers.host // o process.env.HOST_PUBLIC
      const publicUrl = `${protocol}://${host}/uploads/${uniqueFileName}`

      return {
        ok: true,
        url: publicUrl,
        filename: uniqueFileName
      }

    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ message: 'Error al subir el archivo' })
    }
  })
}