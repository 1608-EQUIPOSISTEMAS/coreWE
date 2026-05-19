// src/routes/editions.js
import editionService from '../services/edition.service.js'
import { generateSchedulePdf } from '../services/pdf.service.js'
import { authenticate, ALL_ADMIN, ALL_COMERCIAL} from '../middlewares/auth.hooks.js'
import {
  editionRegisterSchema,
  editionTreeRegisterSchema,
  auditLogsGetSchema,
  editionListSchema,
  classroomMetricsListSchema,
  classroomStudentsListSchema,
  classroomAuditGetSchema,
  classroomAuditSaveSchema,
  classroomAuditSummaryListSchema,
  editionByWeekListSchema,
  editionGetSchema,
  editionUpdateSchema,
  editionCallerSchema,
  editionExtraInfoCallerSchema,
  editionTreeUpdateSchema
} from '../models/edition.schema.js'

export default async function editionRoutes(fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/editionregister', {
    schema: editionRegisterSchema,
    // preHandler: [authenticate, ALL_ADMIN]
  }, async (req, reply) => {
    const response = await editionService.editionRegister(req.body)
    return reply.code(201).send(response)
  })

  fastify.post('/editiontreeregister', {
    schema: editionTreeRegisterSchema,
    // preHandler: [authenticate, ALL_ADMIN]
  }, async (req, reply) => {
    const response = await editionService.editionTreeRegister(req.body)
    return reply.code(201).send(response)
  })

  fastify.post('/auditlogsget', {
    schema: auditLogsGetSchema,
    // preHandler: [authenticate, ALL_ADMIN]
  }, async (req, reply) => {
    const { edition_id, limit, offset } = req.body
    const data = await editionService.auditLogsGet({ edition_id, limit, offset })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/editionlist', {
    schema: editionListSchema,
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await editionService.editionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/editionbyweeklist', {
    schema: editionByWeekListSchema,
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await editionService.editionByWeeklist(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/classroommetricslist', {
    schema: classroomMetricsListSchema,
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await editionService.classroomMetricsList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/classroomstudentslist', {
    schema: classroomStudentsListSchema,
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await editionService.classroomStudentsList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/classroomauditget', {
    schema: classroomAuditGetSchema,
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await editionService.classroomAuditGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/classroomauditsummarylist', {
    schema: classroomAuditSummaryListSchema,
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await editionService.classroomAuditSummaryList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/classroomauditsave', {
    schema: classroomAuditSaveSchema,
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, async (req, reply) => {
    const result = await editionService.classroomAuditSave(req.body)
    return reply.code(result.ok ? 200 : 400).send(result)
  })

  // Multipart: transcript_text + syllabus_image + edition_id + session_number.
  // Sin schema porque @fastify/multipart parsea manualmente; validamos en
  // el handler. La IA puede demorar 30-60s; configuramos timeout amplio.
  fastify.post('/classroomauditrunai', {
    bodyLimit: 25 * 1024 * 1024, // 25 MB para imagen del syllabus
  }, async (req, reply) => {
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
    const result = await editionService.classroomAuditRunAi({
      edition_id: Number(fields.edition_id),
      session_number: Number(fields.session_number),
      transcript_text: fields.transcript_text,
      syllabus_image: imageBuffer,
      syllabus_filename: imageFilename,
    })
    return reply.code(result.ok ? 200 : 400).send(result)
  })

  fastify.post('/editionget', {
    schema: editionGetSchema,
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, async (req, reply) => {
    const { id } = req.body
    const data = await editionService.editionGet({ id })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/editionupdate', {
    schema: editionUpdateSchema,
    // preHandler: [authenticate, ALL_ADMIN]
  }, async (req, reply) => {
    const response = await editionService.editionUpdate(req.body)
    return reply.code(201).send(response)
  })

  fastify.post('/editioncaller', {
    schema: editionCallerSchema,
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, async (req, reply) => {
    const items = await editionService.editionCaller(req.body)
    return reply.code(200).send({ ok: true, items })
  })

  fastify.post('/editionextrainfocaller', {
    schema: editionExtraInfoCallerSchema,
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, async (req, reply) => {
    const items = await editionService.editionextrainfocaller(req.body)
    return reply.code(200).send({ ok: true, items })
  })

  fastify.post('/bulkupdatewhatsapp', {
    schema: {
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                abbreviation: { type: 'string' },
                start_date: { type: 'string' },
                whatsapp_link: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const data = await editionService.bulkUpdateWhatsapp(req.body.items)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/editiontreeupdate', {
    schema: editionTreeUpdateSchema,
    // preHandler: [authenticate, ALL_ADMIN]
  }, async (req, reply) => {
    const response = await editionService.editionTreeUpdate(req.body)
    return reply.code(201).send(response)
  })

  // ── A5 MIGRATION: Listar alumnos vigentes en una edicion ─────────────────
  fastify.post('/a5pendingenrollments', {
    schema: {
      body: {
        type: 'object',
        required: ['edition_num_id'],
        additionalProperties: false,
        properties: {
          edition_num_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const items = await editionService.a5PendingEnrollments({ edition_num_id: req.body.edition_num_id })
    return reply.code(200).send({ ok: true, items })
  })

  // ── A5 MIGRATION: Ejecutar migracion masiva + cancelacion ────────────────
  fastify.post('/a5migrationexecute', {
    schema: {
      body: {
        type: 'object',
        required: ['edition_num_id', 'migrations', 'justificacion'],
        additionalProperties: false,
        properties: {
          edition_num_id: { type: 'integer' },
          a5_segment_id:  { type: ['integer', 'null'] },
          justificacion:  { type: 'string', minLength: 1 },
          user_id:        { type: ['integer', 'null'] },
          migrations: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['enrollment_id', 'target_edition_id'],
              additionalProperties: false,
              properties: {
                enrollment_id:     { type: 'integer' },
                target_edition_id: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { user_id, ...rest } = req.body
    const resolvedUser = req.user?.id ?? user_id ?? null
    const response = await editionService.a5MigrationExecute({ payload: rest, user_id: resolvedUser })
    return reply.code(200).send(response)
  })

  // ── PDF: Programación del Curso ──────────────────────────────────────────
  fastify.post('/schedule-pdf', {
    schema: {
      body: {
        type: 'object',
        required: ['parent_edition_id', 'child_edition_id'],
        properties: {
          parent_edition_id: { type: 'number' },
          child_edition_id:  { type: 'number' },
        }
      }
    }
  }, async (req, reply) => {
    const { parent_edition_id, child_edition_id } = req.body
    const pdfBuffer = await generateSchedulePdf(parent_edition_id, child_edition_id)
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="programacion-${child_edition_id}.pdf"`)
      .send(pdfBuffer)
  })

}