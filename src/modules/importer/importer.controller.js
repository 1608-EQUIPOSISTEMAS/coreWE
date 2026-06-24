import * as usecases from './importer.usecases.js'
import { DomainError } from '../../shared/errors.js'

// Adapters HTTP del modulo de importacion. Para los endpoints de archivo,
// @fastify/multipart parsea manualmente (igual que edition.controller.js): se
// lee el primer part de tipo file y se pasa su buffer al usecase.

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function entitiesHandler (req, reply) {
  return reply.code(200).send({ ok: true, data: usecases.getEntities() })
}

export async function templateHandler (req, reply) {
  const { buffer, filename } = await usecases.buildTemplate(req.params.entity)
  return reply
    .code(200)
    .header('Content-Type', XLSX_MIME)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(buffer)
}

export async function validateHandler (req, reply) {
  const buffer = await readUploadedFile(req)
  const data = await usecases.validateFile(req.params.entity, buffer)
  return reply.code(200).send({ ok: true, data })
}

export async function commitHandler (req, reply) {
  const buffer = await readUploadedFile(req)
  const userId = req.user?.id
  const data = await usecases.commitFile(req.params.entity, buffer, userId, req.query?.jobId)
  return reply.code(200).send({ ok: true, data })
}

// Progreso de una importacion en curso (lo consulta el frontend por polling). El
// jobId lo genera el cliente y lo manda en la request de commit.
export async function progressHandler (req, reply) {
  return reply.code(200).send({ ok: true, data: usecases.getProgress(req.params.jobId) })
}

export async function validateUrlHandler (req, reply) {
  const url = requireUrl(req)
  const data = await usecases.validateUrl(req.params.entity, url)
  return reply.code(200).send({ ok: true, data })
}

export async function commitUrlHandler (req, reply) {
  const url = requireUrl(req)
  const data = await usecases.commitUrl(req.params.entity, url, req.user?.id, req.body?.jobId)
  return reply.code(200).send({ ok: true, data })
}

function requireUrl (req) {
  const url = req.body?.url
  if (!url || typeof url !== 'string') throw new DomainError('Falta la URL del Google Sheet.')
  return url
}

// Extrae el buffer del archivo subido. Espera multipart con un part de tipo
// file (cualquier fieldname); rechaza si no hay archivo o no es .xlsx.
async function readUploadedFile (req) {
  if (!req.isMultipart()) {
    throw new DomainError('Se esperaba multipart/form-data con un archivo Excel.')
  }
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const name = part.filename || ''
      if (!name.toLowerCase().endsWith('.xlsx')) {
        throw new DomainError('El archivo debe ser .xlsx (Excel).')
      }
      return part.toBuffer()
    }
  }
  throw new DomainError('No se recibio ningun archivo.')
}
