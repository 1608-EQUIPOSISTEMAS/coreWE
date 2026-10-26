import { authenticate, hasSubmoduleOrRole, hasRole } from '../../shared/http/auth.middleware.js'
import { listCurrentMembers, setCheck } from './academica-membresias.usecases.js'
import { CHECKPOINTS } from './academica-membresias.entity.js'

// Expone el contacto de los socios (Ley 29733): entra quien tenga la casilla
// ACADEMICA > MEMBRESIAS en Roles y Permisos; sin casilla, solo ADMIN.
const VE_MEMBRESIAS = hasSubmoduleOrRole('ACADEMICA', 'MEMBRESIAS', ['ADMIN'])
// Marcar los checks es trabajo de Academica: GERENCIA solo consulta aunque
// tenga la casilla.
const MARCA = [VE_MEMBRESIAS, hasRole(['ADMIN', 'LIDER_ACADEMICA', 'ACADEMICA'])]

const checkSchema = {
  tags: ['Academica Membresias'],
  summary: 'Marca o desmarca un check de acompañamiento (S1, M1..M12)',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['enrollment_id', 'checkpoint', 'checked'],
    properties: {
      enrollment_id: { type: 'integer', minimum: 1 },
      checkpoint: { type: 'string', enum: CHECKPOINTS },
      checked: { type: 'boolean' },
      // api.js del front lo inyecta en todo POST; la identidad sale del token.
      user_id: { type: 'integer' }
    }
  }
}

export default async function academicaMembresiasRoutes (fastify) {
  fastify.get('/vigentes', { preHandler: [authenticate, VE_MEMBRESIAS] }, async (req, reply) => {
    return reply.send({ ok: true, data: await listCurrentMembers() })
  })
  fastify.post('/check', { schema: checkSchema, preHandler: [authenticate, ...MARCA] }, async (req, reply) => {
    const { enrollment_id: enrollmentId, checkpoint, checked } = req.body
    await setCheck({ enrollmentId, checkpoint, checked }, req.user.id)
    return reply.send({ ok: true })
  })
}
