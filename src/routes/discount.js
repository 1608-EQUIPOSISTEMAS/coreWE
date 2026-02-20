// src/routes/discounts.js
import discountService from '../services/discount.service.js'
import { authenticate, ADMIN_COMERCIAL } from '../hooks/auth.hooks.js'
import {
  discountRegisterSchema,
  discountListSchema,
  discountGetSchema,
  discountUpdateSchema,
  discountCallerSchema
} from '../schemas/discount.schema.js'

export default async function discountRoutes(fastify) {

  fastify.post('/discountregister', {
    schema: discountRegisterSchema,
    preHandler: [authenticate, ADMIN_COMERCIAL]
  }, async (req, reply) => {
    const payload = req.body
    const { discount_id } = await discountService.discountRegister(payload)
    return reply.code(201).send({ ok: true, discount_id })
  })

  fastify.post('/discountlist', {
    schema: discountListSchema,
    preHandler: [authenticate, ADMIN_COMERCIAL]
  }, async (req, reply) => {
    const data = await discountService.discountList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/discountget', {
    schema: discountGetSchema,
    preHandler: [authenticate, ADMIN_COMERCIAL]
  }, async (req, reply) => {
    const { data } = await discountService.discountGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/discountupdate', {
    schema: discountUpdateSchema,
    preHandler: [authenticate, ADMIN_COMERCIAL]
  }, async (req, reply) => {
    const { discount_id } = await discountService.discountUpdate(req.body)
    return reply.code(200).send({ ok: true, discount_id })
  })

  fastify.post('/discountcaller', {
    schema: discountCallerSchema,
    preHandler: [authenticate, ADMIN_COMERCIAL]
  }, async (req, reply) => {
    const data = await discountService.discountCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

}