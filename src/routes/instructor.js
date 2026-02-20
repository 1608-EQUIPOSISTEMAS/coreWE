// src/routes/instructors.js
import instructorService from '../services/instructor.service.js'
import { authenticate, ALL_PRODUCTO } from '../hooks/auth.hooks.js'
import {
  instructorRegisterSchema,
  instructorListSchema,
  instructorGetSchema,
  instructorUpdateSchema,
  instructorCallerSchema
} from '../schemas/instructor.schema.js'

export default async function instructorRoutes(fastify) {

  fastify.post('/instructorregister', {
    schema: instructorRegisterSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const payload = req.body
    const { instructor_id, person_id, data } = await instructorService.instructorRegister(payload)
    return reply.code(201).send({ ok: true, instructor_id, person_id, data })
  })

  fastify.post('/instructorlist', {
    schema: instructorListSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const data = await instructorService.instructorList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/instructorget', {
    schema: instructorGetSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const { data } = await instructorService.instructorGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/instructorupdate', {
    schema: instructorUpdateSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const { instructor_id, person_id, data } = await instructorService.instructorUpdate(req.body)
    return reply.code(200).send({ ok: true, instructor_id, person_id, data })
  })

  fastify.post('/instructorcaller', {
    schema: instructorCallerSchema,
    preHandler: [authenticate, ALL_PRODUCTO]
  }, async (req, reply) => {
    const items = await instructorService.instructorCaller(req.body)
    return reply.code(200).send({ ok: true, items })
  })

}