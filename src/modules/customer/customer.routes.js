import { authenticate } from '../../shared/http/auth.middleware.js'
import {
  customerRegisterSchema,
  customerListSchema,
  customerGetSchema,
  customerInfoGetSchema,
  customerUpdateSchema,
  customerCallerSchema,
  sunatGetSchema
} from './customer.schemas.js'
import * as ctrl from './customer.controller.js'

export default async function customerRoutes (fastify) {
  fastify.post('/customerregister', { schema: customerRegisterSchema, preHandler: [authenticate] }, ctrl.registerHandler)
  fastify.post('/customerlist', { schema: customerListSchema, preHandler: [authenticate] }, ctrl.listHandler)
  fastify.post('/customerget', { schema: customerGetSchema, preHandler: [authenticate] }, ctrl.getHandler)
  fastify.post('/customerinfoget', { schema: customerInfoGetSchema, preHandler: [authenticate] }, ctrl.infoGetHandler)
  fastify.post('/customerupdate', { schema: customerUpdateSchema, preHandler: [authenticate] }, ctrl.updateHandler)
  fastify.post('/customercaller', { schema: customerCallerSchema, preHandler: [authenticate] }, ctrl.callerHandler)
  fastify.post('/sunatget', { schema: sunatGetSchema, preHandler: [authenticate] }, ctrl.sunatGetHandler)
}
