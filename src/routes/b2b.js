// src/routes/b2b.js
import b2bService from '../services/b2b.service.js'
import { authenticate, ALL_B2B } from '../middlewares/auth.hooks.js'

export default async function b2bRoutes (fastify) {

  // ── COMPANY ────────────────────────────────────────────────
  fastify.post('/companycaller', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.companyCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/companylist', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.companyList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/companyget', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.companyGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/companyregister', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const response = await b2bService.companyRegister(req.body)
    return reply.code(200).send(response)
  })

  fastify.post('/companyupdate', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const response = await b2bService.companyUpdate(req.body)
    return reply.code(200).send(response)
  })

  // ── LEAD EMPRESA (NUEVO) ───────────────────────────────────

  fastify.post('/leadlist', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.companyLeadList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/leadget', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    // req.body debe contener { "lead_id": 123 }
    const data = await b2bService.companyLeadGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/leadregister', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    // req.body debe contener: 
    // { "lead": {...}, "contact_attempts": [...], "user_registration_id": 1 }
    // O puedes sacar el user_registration_id desde req.user.id si tu auth middleware lo inyecta
    const response = await b2bService.companyLeadRegister(req.body)
    return reply.code(200).send(response)
  })

  // ── CONTRACT ───────────────────────────────────────────────

  fastify.post('/contractlist', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.contractList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/contractget', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.contractGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/contractregister', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const response = await b2bService.contractRegister(req.body)
    return reply.code(200).send(response)
  })

  fastify.post('/contractupdate', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const response = await b2bService.contractUpdate(req.body)
    return reply.code(200).send(response)
  })

  // ── AGREEMENT ──────────────────────────────────────────────

  fastify.post('/agreementlist', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.agreementList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/agreementget', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const data = await b2bService.agreementGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/agreementregister', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const response = await b2bService.agreementRegister(req.body)
    return reply.code(200).send(response)
  })

  fastify.post('/agreementupdate', {
    preHandler: [authenticate, ALL_B2B]
  }, async (req, reply) => {
    const response = await b2bService.agreementUpdate(req.body)
    return reply.code(200).send(response)
  })

}