import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import { updateMembershipActivationDateSchema, membershipActivationParamsSchema } from './membership.schemas.js'
import * as ctrl from './membership.controller.js'

// Rutas del subdominio membership. La reprogramacion de fecha de activacion solo
// exige sesion (authenticate) — sin gate de rol, igual que el legacy en
// routes/fico.js, que aplicaba authenticate de forma global al plugin FICO.
export default async function membershipRoutes (fastify) {
  fastify.patch('/membershipactivationdate', {
    preHandler: [authenticate],
    schema: updateMembershipActivationDateSchema
  }, ctrl.updateMembershipActivationDateHandler)

  // Estado y reintento de la activacion en Odoo. Mismos roles que la ficha de
  // la inscripcion (router del front: inscripciones/:id).
  const FICHA_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO', 'GERENCIA']
  fastify.get('/membresias/:enrollmentId/activacion', {
    preHandler: [authenticate, hasRole(FICHA_ROLES)],
    schema: membershipActivationParamsSchema
  }, ctrl.getMembershipActivationStatusHandler)

  fastify.post('/membresias/:enrollmentId/activacion/reintentar', {
    preHandler: [authenticate, hasRole(FICHA_ROLES)],
    schema: membershipActivationParamsSchema
  }, ctrl.retryMembershipActivationHandler)

  // Expone el contacto de todos los socios: solo FICO y quien decide.
  fastify.get('/membresias/vencimientos', {
    preHandler: [authenticate, hasRole(['ADMIN', 'FICO', 'LIDER_FICO', 'GERENCIA'])]
  }, ctrl.listMembershipExpiriesHandler)
}
