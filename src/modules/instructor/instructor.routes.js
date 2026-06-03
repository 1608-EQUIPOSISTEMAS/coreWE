import { authenticate, ALL_PRODUCTO, PRODUCTO_COMERCIAL } from '../../shared/http/auth.middleware.js'
import {
  instructorRegisterSchema,
  instructorListSchema,
  instructorGetSchema,
  instructorUpdateSchema,
  instructorCallerSchema
} from './instructor.schemas.js'
import * as ctrl from './instructor.controller.js'

export default async function instructorRoutes (fastify) {
  fastify.post('/instructorregister', { schema: instructorRegisterSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.registerHandler)
  fastify.post('/instructorlist', { schema: instructorListSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.listHandler)
  fastify.post('/instructorget', { schema: instructorGetSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.getHandler)
  fastify.post('/instructorupdate', { schema: instructorUpdateSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.updateHandler)
  fastify.post('/instructorcaller', { schema: instructorCallerSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.callerHandler)
}
