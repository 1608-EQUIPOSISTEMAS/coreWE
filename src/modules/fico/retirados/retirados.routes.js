import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import { enviarEncuestasSchema } from './retirados.schemas.js'
import * as ctrl from './retirados.controller.js'

// Expone contacto y respuestas de los retirados: solo FICO y quien decide.
const ROLES = ['ADMIN', 'FICO', 'LIDER_FICO', 'GERENCIA']

export default async function retiradosRoutes (fastify) {
  fastify.get('/retirados', {
    preHandler: [authenticate, hasRole(ROLES)]
  }, ctrl.listRetiradosHandler)

  fastify.post('/retirados/encuesta', {
    preHandler: [authenticate, hasRole(ROLES)],
    schema: enviarEncuestasSchema
  }, ctrl.enviarEncuestasHandler)
}
