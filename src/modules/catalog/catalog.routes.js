import { authenticate } from '../../shared/http/auth.middleware.js'
import { catalogListSchema, membershipListSchema } from './catalog.schemas.js'
import * as ctrl from './catalog.controller.js'

export default async function catalogRoutes (fastify) {
  fastify.post('/cataloglist', { schema: catalogListSchema, preHandler: [authenticate] }, ctrl.catalogListHandler)
  fastify.post('/membershiplist', { schema: membershipListSchema, preHandler: [authenticate] }, ctrl.membershipListHandler)
}
