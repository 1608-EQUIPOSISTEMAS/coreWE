import { authenticate, hasSubmoduleOrRole } from '../../shared/http/auth.middleware.js'
import { listClassroomSummary, listStudents } from './academica-seguimiento.usecases.js'

// Expone el correo de los alumnos (Ley 29733): entra quien tenga la casilla
// ACADEMICA > SEGUIMIENTO_ALUMNO en Roles y Permisos; sin casilla, solo ADMIN.
const VE_SEGUIMIENTO = hasSubmoduleOrRole('ACADEMICA', 'SEGUIMIENTO_ALUMNO', ['ADMIN'])

const studentsSchema = {
  tags: ['Academica Seguimiento'],
  summary: 'Alumnos de un aula con su nota final y estado',
  params: {
    type: 'object',
    required: ['editionId'],
    properties: { editionId: { type: 'integer', minimum: 1 } }
  }
}

export default async function academicaSeguimientoRoutes (fastify) {
  fastify.get('/aulas', { preHandler: [authenticate, VE_SEGUIMIENTO] }, async (req, reply) => {
    return reply.send({ ok: true, data: await listClassroomSummary() })
  })
  fastify.get('/aulas/:editionId/alumnos', { schema: studentsSchema, preHandler: [authenticate, VE_SEGUIMIENTO] }, async (req, reply) => {
    return reply.send({ ok: true, data: await listStudents(req.params.editionId) })
  })
}
