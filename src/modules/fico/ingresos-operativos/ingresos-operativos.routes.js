import { authenticate, hasSubmoduleOrRole } from '../../../shared/http/auth.middleware.js'
import { ingresosOperativos } from './ingresos-operativos.usecases.js'

// Submodulo de Finanzas con casilla propia en la matriz (FICO >
// INGRESOS_OPERATIVOS, scripts/seed-ingresos-operativos.sql). Quien lo ve lo
// decide la matriz de Roles y Permisos; sin casilla solo entra ADMIN (el modulo
// aun no esta habilitado para el resto).
const VE_INGRESOS = hasSubmoduleOrRole('FICO', 'INGRESOS_OPERATIVOS', ['ADMIN'])

const MES = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }

const consultaSchema = {
  tags: ['Ingresos Operativos'],
  summary: 'Pagos B2C del rango de meses (sin B2B) y su resumen por línea',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['desde'],
    properties: {
      desde: MES,
      hasta: MES,
      tipo_cambio: { type: 'number', exclusiveMinimum: 0, maximum: 20 },
      // api.js del front lo inyecta en todo POST.
      user_id: { type: 'integer' }
    }
  }
}

export default async function ingresosOperativosRoutes (fastify) {
  fastify.post('/consulta', { schema: consultaSchema, preHandler: [authenticate, VE_INGRESOS] }, async (req, reply) => {
    return reply.code(200).send({ ok: true, data: await ingresosOperativos(req.body) })
  })
}
