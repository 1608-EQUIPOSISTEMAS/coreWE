import { authenticate } from '../../shared/http/auth.middleware.js'
import { ingresosB2CHandler } from './marketing.controller.js'

export default async function marketingRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)
  fastify.post('/ingresos-b2c', ingresosB2CHandler)
}
