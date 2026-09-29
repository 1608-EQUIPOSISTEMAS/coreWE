import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import { reporteFico } from './report.usecases.js'

// El informe del area es para quien decide, igual que el Comercial y el Academico.
const VE_INFORME = hasRole(['ADMIN', 'GERENCIA', 'LIDER_FICO'])

const reportSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['date_start', 'date_end'],
    properties: {
      date_start: { type: 'string', format: 'date' },
      date_end: { type: 'string', format: 'date' }
    }
  }
}

export default async function ficoReportRoutes (fastify) {
  fastify.post('/reporte', { preHandler: [authenticate, VE_INFORME], schema: reportSchema }, async (req, reply) => {
    return reply.send({ ok: true, data: await reporteFico(req.body) })
  })
}
