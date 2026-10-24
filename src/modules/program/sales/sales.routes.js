import { authenticate, hasSubmoduleOrRole } from '../../../shared/http/auth.middleware.js'
import { productSales } from './sales.usecases.js'

// Solo cantidades y soles vendidos: sin margenes ni costos, que siguen en FICO.
// Ademas de los roles fijos, entra quien tenga la casilla Producto > Ventas en
// Configuracion > Roles y Permisos (scripts/seed-producto-ventas.sql): si no, la
// pantalla se abria por la matriz y el endpoint respondia 403.
const VE_VENTAS = hasSubmoduleOrRole('PRODUCTO', 'VENTAS', ['ADMIN', 'GERENCIA', 'LIDER_PRODUCTO', 'PRODUCTO'])

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
