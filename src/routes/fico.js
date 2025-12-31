//fico
// src/routes/fico.js
import ficoService from '../services/fico.service.js'

export default async function ficoRoutes (fastify) {
  fastify.post('/enrollmentlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: ['string', 'null'] },
          cat_type_status: { type: ['integer', 'null'] },
          cat_fico_status: { type: ['integer', 'null'] },
          date_from: { type: ['string', 'null'] },
          date_to: { type: ['string', 'null'] },
          seller_agent_id: { type: ['integer', 'null'] },
          validator_user_id: { type: ['integer', 'null'] },
          page: { type: ['integer', 'null'], default: 1 },
          size: { type: ['integer', 'null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.enrollmentList(req.body)
    return reply.code(200).send({ ok: true, data })
  })
  
  fastify.post('/paymentdetailget', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: false,
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.paymentDetailGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })
  
}