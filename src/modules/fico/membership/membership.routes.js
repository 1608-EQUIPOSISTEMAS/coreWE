import { authenticate } from '../../../shared/http/auth.middleware.js'
import { updateMembershipActivationDateSchema } from './membership.schemas.js'
import * as ctrl from './membership.controller.js'

// Rutas del subdominio membership. La reprogramacion de fecha de activacion solo
// exige sesion (authenticate) — sin gate de rol, igual que el legacy en
// routes/fico.js, que aplicaba authenticate de forma global al plugin FICO.
export default async function membershipRoutes (fastify) {
  fastify.patch('/membershipactivationdate', {
    preHandler: [authenticate],
    schema: updateMembershipActivationDateSchema
  }, ctrl.updateMembershipActivationDateHandler)
}
