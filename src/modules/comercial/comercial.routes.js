import { authenticate, ALL_COMERCIAL } from '../../shared/http/auth.middleware.js'
import {
  leadRegisterSchema,
  leadUpdateSchema,
  enrollmentGetSchema,
  enrollmentRegisterSchema,
  leadGetSchema,
  restrictionsListSchema,
  restrictionsUpdateSchema,
  leadListSchema,
  leadStatsSchema,
  searchPhoneGetSchema,
  searchContactSchema
} from './comercial.schemas.js'
import * as ctrl from './comercial.controller.js'

export default async function comercialRoutes (fastify) {
  fastify.post('/leadregister', { schema: leadRegisterSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.leadRegisterHandler)
  fastify.post('/leadupdate', { schema: leadUpdateSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.leadUpdateHandler)
  fastify.post('/leadget', { schema: leadGetSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.leadGetHandler)
  fastify.post('/leadlist', { schema: leadListSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.leadListHandler)
  fastify.get('/sellerphones', { preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.sellerPhonesHandler)
  fastify.post('/leadstats', { schema: leadStatsSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.leadStatsHandler)
  fastify.post('/enrollmentget', { schema: enrollmentGetSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.enrollmentGetHandler)
  fastify.post('/enrollmentregister', { schema: enrollmentRegisterSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.enrollmentRegisterHandler)
  fastify.post('/enrollment/upload', { preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.enrollmentUploadHandler)
  fastify.post('/restrictionslist', { schema: restrictionsListSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.restrictionsListHandler)
  fastify.post('/restrictionsupdate', { schema: restrictionsUpdateSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.restrictionsUpdateHandler)
  fastify.post('/searchphoneget', { schema: searchPhoneGetSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.searchPhoneGetHandler)
  fastify.post('/enrollment-slack-web', { preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.enrollmentSlackWebHandler)
  fastify.post('/searchcontact', { schema: searchContactSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.searchContactHandler)
  fastify.post('/programVersionlist', { preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.programVersionListHandler)
  fastify.post('/editionlist', { preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.editionListHandler)
}
