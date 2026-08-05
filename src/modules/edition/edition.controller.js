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

export async function weeklySessionsHandler (req, reply) {
  const data = await usecases.editionWeeklySessions(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function weeklyControlHandler (req, reply) {
  const data = await usecases.editionWeeklyControl(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function sessionControlSaveHandler (req, reply) {
  const data = await usecases.editionSessionControlSave({
    ...req.body,
    user_id: req.user?.id ?? null
  })
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

export async function classroomStudentsHistoryHandler (req, reply) {
  const data = await usecases.classroomStudentsHistory(req.body)
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

export async function classroomGradesGetHandler (req, reply) {
  const data = await usecases.classroomGradesGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function classroomGradesSaveHandler (req, reply) {
  const result = await usecases.classroomGradesSave(req.body)
  return reply.code(result.ok ? 200 : 400).send(result)
}

export async function classroomOdooCertifyHandler (req, reply) {
  const result = await usecases.classroomOdooCertify(req.body)
  return reply.code(result.ok ? 200 : 400).send(result)
}

export async function classroomGradesObservationsHandler (req, reply) {
  const result = await usecases.classroomGradesObservations(req.body)
  return reply.code(result.ok ? 200 : 502).send(result)
}

export async function reportRecommendationsHandler (req, reply) {
  const result = await usecases.reportRecommendations(req.body)
  return reply.code(result.ok ? 200 : 502).send(result)
}

export async function academicReportHandler (req, reply) {
  const data = await usecases.academicReport(req.body || {})
  return reply.code(200).send({ ok: true, data })
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

export async function eventEditionsListHandler (req, reply) {
  const data = await usecases.eventEditionsList(req.body || {})
  return reply.code(200).send({ ok: true, data })
}

export async function eventCategoriesGetHandler (req, reply) {
  const data = await usecases.eventCategoriesGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function eventCategoriesSaveHandler (req, reply) {
  const data = await usecases.eventCategoriesSave(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function eventResourcesGetHandler (req, reply) {
  const data = await usecases.eventResourcesGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function eventBannerGetHandler (req, reply) {
  const data = await usecases.eventBannerGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function eventResourcesSaveHandler (req, reply) {
  const data = await usecases.eventResourcesSave(req.body)
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

export async function b2bTrackingListHandler (req, reply) {
  const data = await usecases.b2bTrackingList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function b2bAttendanceSaveHandler (req, reply) {
  const result = await usecases.b2bAttendanceSave(req.body)
  return reply.code(result.ok ? 200 : 400).send(result)
}
