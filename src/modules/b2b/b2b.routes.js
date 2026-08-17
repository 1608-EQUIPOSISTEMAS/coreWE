import { authenticate, ALL_B2B } from '../../shared/http/auth.middleware.js'
import {
  companyCallerSchema,
  companyListSchema,
  companyGetSchema,
  companyRegisterSchema,
  companyUpdateSchema,
  leadListSchema,
  leadGetSchema,
  leadRegisterSchema,
  contractListSchema,
  contractGetSchema,
  contractRegisterSchema,
  contractUpdateSchema,
  contractEnrollSchema
} from './b2b.schemas.js'
import * as ctrl from './b2b.controller.js'

export default async function b2bRoutes (fastify) {
  // ── COMPANY ────────────────────────────────────────────────
  fastify.post('/companycaller', { schema: companyCallerSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.companyCallerHandler)
  fastify.post('/companylist', { schema: companyListSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.companyListHandler)
  fastify.post('/companyget', { schema: companyGetSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.companyGetHandler)
  fastify.post('/companyregister', { schema: companyRegisterSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.companyRegisterHandler)
  fastify.post('/companyupdate', { schema: companyUpdateSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.companyUpdateHandler)

  // ── LEAD EMPRESA ───────────────────────────────────────────
  fastify.post('/leadlist', { schema: leadListSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.leadListHandler)
  fastify.post('/leadget', { schema: leadGetSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.leadGetHandler)
  fastify.post('/leadregister', { schema: leadRegisterSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.leadRegisterHandler)

  // ── CONTRACT ───────────────────────────────────────────────
  fastify.post('/contractlist', { schema: contractListSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.contractListHandler)
  fastify.post('/contractget', { schema: contractGetSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.contractGetHandler)
  fastify.post('/contractregister', { schema: contractRegisterSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.contractRegisterHandler)
  fastify.post('/contractupdate', { schema: contractUpdateSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.contractUpdateHandler)
  fastify.post('/contractenroll', { schema: contractEnrollSchema, preHandler: [authenticate, ALL_B2B] }, ctrl.contractEnrollHandler)
}
