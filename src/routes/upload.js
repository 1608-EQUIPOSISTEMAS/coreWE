// src/routes/upload.js
import fs from 'fs'
import path from 'path'
import util from 'util'
import { pipeline } from 'stream'

const pump = util.promisify(pipeline)

export default async function uploadRoutes(fastify, options) {

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

      // Generar nombre único: TIMESTAMP_NOMBRE_LIMPIO
      const cleanName = data.filename.replace(/\s+/g, '_')
      const uniqueFileName = `${Date.now()}_${cleanName}`
      const savePath = path.join(UPLOAD_FOLDER, uniqueFileName)

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