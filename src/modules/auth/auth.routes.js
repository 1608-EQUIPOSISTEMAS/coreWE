import { authenticate, ALL_INTERNAL } from '../../shared/http/auth.middleware.js'
import { loginSchema } from './auth.schemas.js'
import * as ctrl from './auth.controller.js'

export default async function authRoutes (fastify) {
  // Publico: aqui se genera el token, no puede llevar authenticate.
  fastify.post('/login', { schema: loginSchema }, ctrl.loginHandler)

  fastify.post('/userlist', { preHandler: [authenticate, ALL_INTERNAL] }, ctrl.userListHandler)
  fastify.post('/userlist-by-role', { preHandler: [authenticate, ALL_INTERNAL] }, ctrl.userListByRoleHandler)
}
