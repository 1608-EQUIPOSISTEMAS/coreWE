// src/routes/comercial.js
import comercialService from '../services/comercial.service.js'

import integrationService from '../services/integration.service.js'  
import {
  authenticate,
  ALL_COMERCIAL
} from '../middlewares/auth.hooks.js'
import {
  leadRegisterSchema,
  leadUpdateSchema,
  enrollmentGetSchema,
  enrollmentRegisterSchema,
  leadGetSchema,
  restrictionsListSchema,
  restrictionsUpdateSchema,
  leadListSchema,
  leadStatsSchema,
  searchPhoneGetSchema,
  searchContactSchema
} from '../models/comercial.schema.js'

export default async function comercialRoutes (fastify) {

  fastify.post('/leadregister', {
    schema: leadRegisterSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const payload = req.body
    console.log('INSCRIPCIÒN:\n', payload)
    const response = await comercialService.leadRegister(payload)
    return reply.code(200).send(response)
  })

  fastify.post('/leadupdate', {
    schema: leadUpdateSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const response = await comercialService.leadUpdate(req.body)
    return reply.code(200).send(response)
  })

  fastify.post('/leadget', {
    schema: leadGetSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const { data } = await comercialService.leadGet(req.body)
    return reply.code(201).send({ ok: true, data })
  })

  fastify.post('/leadlist', {
    schema: leadListSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await comercialService.leadList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/leadstats', {
    schema: leadStatsSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await comercialService.leadStats(req.body)
    return reply.code(200).send(data)
  })

  fastify.post('/enrollmentget', {
    schema: enrollmentGetSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const { enrollment_id } = req.body
    const data = await comercialService.enrollmentGet(enrollment_id)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/enrollmentregister', {
    schema: enrollmentRegisterSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const response = await comercialService.enrollmentRegister(req.body)
    return reply.code(200).send(response)
  })

  fastify.post('/enrollment/upload', {
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const parts = req.parts()
    let enrollment_id = null
    let paymentFileObj = null
    let studentFileObj = null

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'enrollment_id') enrollment_id = part.value
      } else if (part.type === 'file') {
        const buffer = await part.toBuffer()
        const fileData = { filename: part.filename, mimetype: part.mimetype, buffer }
        if (part.fieldname === 'payment_file') paymentFileObj = fileData
        else if (part.fieldname === 'student_file') studentFileObj = fileData
      }
    }

    if (!enrollment_id) return reply.code(400).send({ error: 'enrollment_id is required' })

    const result = await comercialService.uploadEnrollmentFiles({
      enrollment_id,
      paymentFile: paymentFileObj,
      studentFile: studentFileObj
    })
    return reply.send(result)
  })

  fastify.post('/restrictionslist', {
    schema: restrictionsListSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await comercialService.userRestrictionsList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/restrictionsupdate', {
    schema: restrictionsUpdateSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await comercialService.userRestrictionsUpdate(req.body.restrictions)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/searchphoneget', {
    schema: searchPhoneGetSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const { phone } = req.body
    const data = await comercialService.searchPhoneGet(phone)
    return reply.code(200).send({ ok: true, ...data })
  })


fastify.post('/enrollment-slack-web', async (request, reply) => {
  const { enrollment_id } = request.body;
  if (!enrollment_id) return reply.status(400).send({ ok: false, message: 'enrollment_id requerido' });

  const result = await integrationService.sendEnrollmentWebToSlack({ enrollment_id });
  return result;
});

  fastify.post('/searchcontact', {
    schema: searchContactSchema,
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const { phone } = req.body
    const data = await comercialService.searchContact({ phone })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programVersionlist', {
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programVersionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/editionlist', {
    preHandler: [authenticate, ALL_COMERCIAL]
  }, async (req, reply) => {
    const data = await programEditionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

}