import * as usecases from './edition.usecases.js'
import { generateSchedulePdf } from '../../services/pdf.service.js'

export async function registerHandler (req, reply) {
  const response = await usecases.editionRegister(req.body)
  return reply.code(201).send(response)
}

export async function treeRegisterHandler (req, reply) {
  const response = await usecases.editionTreeRegister(req.body)
  return reply.code(201).send(response)
}

export async function auditLogsGetHandler (req, reply) {
  const { edition_id, limit, offset } = req.body
  const data = await usecases.auditLogsGet({ edition_id, limit, offset })
  return reply.code(200).send({ ok: true, data })
}

export async function listHandler (req, reply) {
  const data = await usecases.editionList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function byWeekListHandler (req, reply) {
  const data = await usecases.editionByWeeklist(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function classroomMetricsListHandler (req, reply) {
  const data = await usecases.classroomMetricsList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function classroomStudentsListHandler (req, reply) {
  const data = await usecases.classroomStudentsList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function classroomAuditGetHandler (req, reply) {
  const data = await usecases.classroomAuditGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function classroomAuditSummaryListHandler (req, reply) {
  const data = await usecases.classroomAuditSummaryList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function classroomAuditSaveHandler (req, reply) {
  const result = await usecases.classroomAuditSave(req.body)
  return reply.code(result.ok ? 200 : 400).send(result)
}

// Multipart: transcript_text + syllabus_image + edition_id + session_number.
// Sin schema porque @fastify/multipart parsea manualmente; validamos en el
// usecase. La IA puede demorar; el timeout de socket vive en la ruta.
export async function classroomAuditRunAiHandler (req, reply) {
  if (!req.isMultipart()) {
    return reply.code(400).send({ ok: false, message: 'Se esperaba multipart/form-data' })
  }
  const fields = { edition_id: null, session_number: null, transcript_text: null }
  let imageBuffer = null
  let imageFilename = null
  for await (const part of req.parts()) {
    if (part.type === 'file' && part.fieldname === 'syllabus_image') {
      imageBuffer = await part.toBuffer()
      imageFilename = part.filename
    } else if (part.type === 'field') {
      fields[part.fieldname] = part.value
    }
  }
  const result = await usecases.classroomAuditRunAi({
    edition_id: Number(fields.edition_id),
    session_number: Number(fields.session_number),
    transcript_text: fields.transcript_text,
    syllabus_image: imageBuffer,
    syllabus_filename: imageFilename
  })
  return reply.code(result.ok ? 200 : 400).send(result)
}

export async function getHandler (req, reply) {
  const { id } = req.body
  const data = await usecases.editionGet({ id })
  return reply.code(200).send({ ok: true, data })
}

export async function updateHandler (req, reply) {
  const response = await usecases.editionUpdate(req.body)
  return reply.code(201).send(response)
}

export async function callerHandler (req, reply) {
  const items = await usecases.editionCaller(req.body)
  return reply.code(200).send({ ok: true, items })
}

export async function extraInfoCallerHandler (req, reply) {
  const items = await usecases.editionextrainfocaller(req.body)
  return reply.code(200).send({ ok: true, items })
}

export async function bulkUpdateWhatsappHandler (req, reply) {
  const data = await usecases.bulkUpdateWhatsapp(req.body.items)
  return reply.code(200).send({ ok: true, data })
}

export async function treeUpdateHandler (req, reply) {
  const response = await usecases.editionTreeUpdate(req.body)
  return reply.code(201).send(response)
}

export async function a5PendingEnrollmentsHandler (req, reply) {
  const items = await usecases.a5PendingEnrollments({ edition_num_id: req.body.edition_num_id })
  return reply.code(200).send({ ok: true, items })
}

export async function a5MigrationExecuteHandler (req, reply) {
  const { user_id, ...rest } = req.body
  const resolvedUser = req.user?.id ?? user_id ?? null
  const response = await usecases.a5MigrationExecute({ payload: rest, user_id: resolvedUser })
  return reply.code(200).send(response)
}

export async function schedulePdfHandler (req, reply) {
  const { parent_edition_id, child_edition_id } = req.body
  const pdfBuffer = await generateSchedulePdf(parent_edition_id, child_edition_id)
  reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="programacion-${child_edition_id}.pdf"`)
    .send(pdfBuffer)
}
