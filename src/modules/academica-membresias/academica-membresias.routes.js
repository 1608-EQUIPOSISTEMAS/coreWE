import { authenticate, hasSubmoduleOrRole } from '../../shared/http/auth.middleware.js'
import { listCurrentMembers } from './academica-membresias.usecases.js'

// Expone el contacto de los socios (Ley 29733): entra quien tenga la casilla
// ACADEMICA > MEMBRESIAS en Roles y Permisos; sin casilla, solo ADMIN.
const VE_MEMBRESIAS = hasSubmoduleOrRole('ACADEMICA', 'MEMBRESIAS', ['ADMIN'])

export default async function academicaMembresiasRoutes (fastify) {
  fastify.get('/vigentes', { preHandler: [authenticate, VE_MEMBRESIAS] }, async (req, reply) => {
    return reply.send({ ok: true, data: await listCurrentMembers() })
  })
}
