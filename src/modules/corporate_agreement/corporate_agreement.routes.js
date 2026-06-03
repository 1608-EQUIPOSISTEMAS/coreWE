import { authenticate } from '../../shared/http/auth.middleware.js'
import {
  agreementRegisterSchema,
  agreementListSchema,
  agreementCallerSchema,
  agreementUpdateSchema
} from './corporate_agreement.schemas.js'
import * as ctrl from './corporate_agreement.controller.js'

export default async function corporateAgreementRoutes (fastify) {
  fastify.post('/agreementregister', { schema: agreementRegisterSchema, preHandler: [authenticate] }, ctrl.registerHandler)
  fastify.post('/agreementlist', { schema: agreementListSchema, preHandler: [authenticate] }, ctrl.listHandler)
  fastify.post('/agreementcaller', { schema: agreementCallerSchema, preHandler: [authenticate] }, ctrl.callerHandler)
  fastify.post('/agreementupdate', { schema: agreementUpdateSchema, preHandler: [authenticate] }, ctrl.updateHandler)
}
