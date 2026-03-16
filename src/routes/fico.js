import ficoService from '../services/fico.service.js'

export default async function ficoRoutes (fastify) {
  fastify.post('/enrollmentlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          q:                        { type: ['string', 'null'] },
          date_from:                { type: ['string', 'null'] },
          date_to:                  { type: ['string', 'null'] },
          edition_start_from:       { type: ['string', 'null'] },
          edition_start_to:         { type: ['string', 'null'] },
          page:                     { type: ['integer', 'null'], default: 1 },
          size:                     { type: ['integer', 'null'], default: 25 },
          order_by:                 { type: ['number', 'null'] },
          student_statuses:         { type: ['array', 'null'], items: { type: 'string' } },
          advisors:                 { type: ['array', 'null'], items: { type: 'string' } },
          program_types:            { type: ['array', 'null'], items: { type: 'string' } },
          modalities:               { type: ['array', 'null'], items: { type: 'string' } },
          payment_channels:         { type: ['array', 'null'], items: { type: 'string' } }
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
