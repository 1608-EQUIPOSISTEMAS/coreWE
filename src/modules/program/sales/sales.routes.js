import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import { productSales } from './sales.usecases.js'

// Solo cantidades y soles vendidos: sin margenes ni costos, que siguen en FICO.
const VE_VENTAS = hasRole(['ADMIN', 'GERENCIA', 'LIDER_PRODUCTO', 'PRODUCTO'])

const salesSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['granularity', 'date'],
    properties: {
      granularity: { type: 'string', enum: ['dia', 'mes', 'trimestre', 'anio'] },
      date: { type: 'string', format: 'date' }
    }
  }
}

export default async function productSalesRoutes (fastify) {
  fastify.post('/ventas', { preHandler: [authenticate, VE_VENTAS], schema: salesSchema }, async (req, reply) => {
    return reply.send({ ok: true, data: await productSales(req.body) })
  })
}
