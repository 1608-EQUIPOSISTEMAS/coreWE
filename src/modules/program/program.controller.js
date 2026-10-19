import * as usecases from './program.usecases.js'
import * as media from './media.usecases.js'
import { mediaKindFor } from './program.entity.js'
import { DomainError } from '../../shared/errors.js'

export async function registerHandler (req, reply) {
  const { program_id, program_versions } = await usecases.registerProgram({ ...req.body, user_id: req.user?.id ?? null })
  return reply.code(201).send({ ok: true, program_id, program_versions })
}

export async function listHandler (req, reply) {
  const data = await usecases.listPrograms(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function getHandler (req, reply) {
  const { data } = await usecases.getProgram(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function updateHandler (req, reply) {
  const { program_id, program_versions } = await usecases.updateProgram({ ...req.body, user_id: req.user?.id ?? null })
  return reply.code(200).send({ ok: true, program_id, program_versions })
}

export async function versionCallerHandler (req, reply) {
  const data = await usecases.callerProgramVersions(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function eventCategoryListHandler (req, reply) {
  const data = await usecases.listEventCategories(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function priceListHandler (req, reply) {
  const data = await usecases.listPrices(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function versionListHandler (req, reply) {
  const data = await usecases.listProgramVersions(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function versionUpdateHandler (req, reply) {
  const result = await usecases.updatePrice(req.body)
  return reply.code(200).send({ ok: true, data: result })
}

export async function callerHandler (req, reply) {
  const data = await usecases.callerPrograms(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function versionDetailGetHandler (req, reply) {
  const { data } = await usecases.getProgramVersionDetail(req.body)
  return reply.code(200).send({ ok: true, data })
}

// ── Archivos del programa (los manda el bot de WhatsApp) ─────────────────────
export async function mediaGetHandler (req, reply) {
  const data = await media.getProgramMedia({ programId: req.body.program_id })
  return reply.send({ ok: true, data })
}

// Multipart: los campos van ANTES del archivo en el FormData del front, así se
// leen en orden sin guardar el archivo en memoria dos veces.
export async function mediaUploadHandler (req, reply) {
  if (!req.isMultipart()) throw new DomainError('Se esperaba multipart/form-data con el archivo.')
  const fields = {}
  for await (const part of req.parts()) {
    if (part.type === 'field') fields[part.fieldname] = part.value
    else {
      const data = await media.uploadProgramMedia({
        programId: Number(fields.program_id),
        slot: fields.slot,
        filename: part.filename || '',
        buffer: await part.toBuffer()
      })
      return reply.send({ ok: true, data })
    }
  }
  throw new DomainError('No se recibió ningún archivo.')
}

export async function mediaDeleteHandler (req, reply) {
  const data = await media.deleteProgramMedia({ programId: req.body.program_id, slot: req.body.slot })
  return reply.send({ ok: true, data })
}

export async function mediaFileHandler (req, reply) {
  const { filename, buffer } = await media.readProgramMediaFile({ programId: req.body.program_id, slot: req.body.slot })
  const type = mediaKindFor(filename, 0)?.mimeType ?? 'application/octet-stream'
  return reply.type(type).header('Cache-Control', 'no-store').send(buffer)
}
