// src/routes/programs.js
import programService from '../services/program.service.js'
import { authenticate, ALL_PRODUCTO, ALL_COMERCIAL } from '../middlewares/auth.hooks.js'
import {
  programRegisterSchema,
  programListSchema,
  programGetSchema,
  programUpdateSchema,
  programVersionCallerSchema,
  priceListSchema,
  programVersionListSchema,
  programVersionUpdateSchema,
  programCallerSchema,
  programVersionDetailGetSchema
} from '../models/program.schema.js'

export default async function programRoutes(fastify) {

  fastify.post('/programregister', {
    schema: programRegisterSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const payload = req.body
    const { program_id, program_versions } = await programService.programRegister(payload)
    return reply.code(201).send({ ok: true, program_id, program_versions })
  })

  fastify.post('/programlist', {
    schema: programListSchema,
    preHandler: [authenticate, ALL_PRODUCTO,ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programService.programList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programget', {
    schema: programGetSchema,
    preHandler: [authenticate, ALL_PRODUCTO,ALL_COMERCIAL]
  }, async (req, reply) => {
    const { data } = await programService.programGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programupdate', {
    schema: programUpdateSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const { program_id, program_versions } = await programService.programUpdate(req.body)
    return reply.code(200).send({ ok: true, program_id, program_versions })
  })

  fastify.post('/programversioncaller', {
    schema: programVersionCallerSchema,
    preHandler: [authenticate, ALL_PRODUCTO, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programService.programVersionCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/pricelist', {
    schema: priceListSchema,
    preHandler: [authenticate, ALL_PRODUCTO,ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programService.priceList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programversionlist', {
    schema: programVersionListSchema,
    preHandler: [authenticate, ALL_PRODUCTO,ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programService.programVersionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programversionupdate', {
    schema: programVersionUpdateSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const result = await programService.priceUpdate(req.body)
    return reply.code(200).send({ ok: true, data: result })
  })

  fastify.post('/programcaller', {
    schema: programCallerSchema,
    preHandler: [authenticate, ALL_PRODUCTO,ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programService.programCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programversiondetailget', {
    schema: programVersionDetailGetSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const { data } = await programService.programVersionDetailGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

}