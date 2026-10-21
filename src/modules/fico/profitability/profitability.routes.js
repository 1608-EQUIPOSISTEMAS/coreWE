import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import { salesByLine, profitByProgram, costInputs, saveInstructorRate, saveMarketing } from './profitability.usecases.js'

// Margenes y tarifas de docentes los ven quienes deciden y el equipo FICO.
// Los costos los carga el lider de FICO.
const VE = hasRole(['ADMIN', 'GERENCIA', 'LIDER_FICO', 'FICO'])
const EDITA = hasRole(['ADMIN', 'LIDER_FICO'])

const periodBody = (extra = {}) => ({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['granularity', 'date', ...Object.keys(extra)],
    properties: {
      granularity: { type: 'string', enum: ['dia', 'mes', 'anio'] },
      date: { type: 'string', format: 'date' },
      ...extra
    }
  }
})

const rateSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['instructor_id', 'hourly_rate'],
    properties: {
      instructor_id: { type: 'integer' },
      hourly_rate: { type: ['number', 'null'], minimum: 0 }
    }
  }
}

const marketingSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['year', 'rows'],
    properties: {
      year: { type: 'integer' },
      rows: {
        type: 'array',
        maxItems: 48,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['month', 'line', 'amount'],
          properties: { month: { type: 'integer' }, line: { type: 'string' }, amount: { type: 'number' } }
        }
      }
    }
  }
}

export default async function ficoProfitabilityRoutes (fastify) {
  fastify.post('/rentabilidad/ventas',
    { preHandler: [authenticate, VE], schema: periodBody({ measure: { type: 'string', enum: ['vendido', 'cobrado'] } }) },
    async (req, reply) => reply.send({ ok: true, data: await salesByLine(req.body) }))

  fastify.post('/rentabilidad/margen', { preHandler: [authenticate, VE], schema: periodBody() },
    async (req, reply) => reply.send({ ok: true, data: await profitByProgram(req.body) }))

  fastify.get('/rentabilidad/costos', {
    preHandler: [authenticate, VE],
    schema: { querystring: { type: 'object', required: ['year'], properties: { year: { type: 'integer' } } } }
  }, async (req, reply) => reply.send({ ok: true, data: await costInputs(req.query) }))

  fastify.put('/rentabilidad/tarifa', { preHandler: [authenticate, EDITA], schema: rateSchema },
    async (req, reply) => reply.send({ ok: true, data: await saveInstructorRate({ ...req.body, userId: req.user?.id }) }))

  fastify.put('/rentabilidad/publicidad', { preHandler: [authenticate, EDITA], schema: marketingSchema },
    async (req, reply) => reply.send({ ok: true, data: await saveMarketing({ ...req.body, userId: req.user?.id }) }))
}
