import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import { reporteProducto } from './report.usecases.js'
import { PRODUCT_LINES } from './report.entity.js'

// El informe del area es para quien decide, igual que el Comercial y el de Finanzas.
const VE_INFORME = hasRole(['ADMIN', 'GERENCIA', 'LIDER_PRODUCTO'])

const reportSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['linea', 'date_start', 'date_end'],
    properties: {
      linea: { type: 'string', enum: Object.keys(PRODUCT_LINES) },
      date_start: { type: 'string', format: 'date' },
      date_end: { type: 'string', format: 'date' }
    }
  }
}

export default async function productReportRoutes (fastify) {
  fastify.post('/reporte', { preHandler: [authenticate, VE_INFORME], schema: reportSchema }, async (req, reply) => {
    return reply.send({ ok: true, data: await reporteProducto(req.body) })
  })
}
