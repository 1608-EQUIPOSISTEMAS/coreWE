// src/routes/editions.js
import editionService from '../services/edition.service.js'
import { authenticate, ALL_ADMIN, ALL_COMERCIAL} from '../middlewares/auth.hooks.js'
import {
  editionRegisterSchema,
  editionTreeRegisterSchema,
  auditLogsGetSchema,
  editionListSchema,
  editionByWeekListSchema,
  editionGetSchema,
  editionUpdateSchema,
  editionCallerSchema,
  editionExtraInfoCallerSchema,
  editionTreeUpdateSchema
} from '../models/edition.schema.js'

export default async function editionRoutes(fastify) {

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

  fastify.post('/editiontreeupdate', {
    schema: editionTreeUpdateSchema,
    // preHandler: [authenticate, ALL_ADMIN]
  }, async (req, reply) => {
    const response = await editionService.editionTreeUpdate(req.body)
    return reply.code(201).send(response)
  })

}