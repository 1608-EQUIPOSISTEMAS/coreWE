import { authenticate } from '../../../shared/http/auth.middleware.js'
import { saveValidationsSchema } from './validation.schemas.js'
import * as ctrl from './validation.controller.js'

// Rutas del subdominio de convalidaciones y estructura padre-hijo. Solo exigen
// usuario autenticado (sin gate de rol), en paridad con el service legacy donde
// estas rutas heredaban unicamente el preHandler global authenticate.
export default async function validationRoutes (fastify) {
  fastify.get('/programchildren/:id', { preHandler: [authenticate] }, ctrl.getProgramChildrenHandler)
  fastify.get('/validations/:enrollmentId', { preHandler: [authenticate] }, ctrl.getValidationsHandler)
  fastify.post('/validations', { preHandler: [authenticate], schema: saveValidationsSchema }, ctrl.saveValidationsHandler)
}
