import { authenticate, hasRole } from '../../shared/http/auth.middleware.js'
import {
  dashboardListSchema,
  programGoalsSchema,
  programGoalsSaveSchema,
  leadsPerEditionSchema,
  targetRegisterSchema,
  detailLeadsSchema,
  contactabilitySchema,
  liderSchema,
  availableWeeksSchema,
  ventasCanalSchema,
  detailSalesSchema
} from './dashboard.schemas.js'
import * as ctrl from './dashboard.controller.js'

export default async function dashboardRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/admin-summary', { preHandler: hasRole(['ADMIN', 'GERENCIA']) }, ctrl.adminSummaryHandler)
  fastify.post('/dashboardlist', { schema: dashboardListSchema }, ctrl.dashboardListHandler)
  fastify.post('/program-goals', { schema: programGoalsSchema }, ctrl.programGoalsHandler)
  fastify.post('/program-goals/save', { schema: programGoalsSaveSchema }, ctrl.programGoalsSaveHandler)
  fastify.post('/leads-per-edition', { schema: leadsPerEditionSchema }, ctrl.leadsPerEditionHandler)
  fastify.post('/dashboardtargetregister', { schema: targetRegisterSchema }, ctrl.targetRegisterHandler)
  fastify.post('/detailleads', { schema: detailLeadsSchema }, ctrl.detailLeadsHandler)
  fastify.post('/contactability', { schema: contactabilitySchema }, ctrl.contactabilityHandler)
  fastify.post('/lider', { schema: liderSchema }, ctrl.liderHandler)
  fastify.post('/available-weeks', { schema: availableWeeksSchema }, ctrl.availableWeeksHandler)
  fastify.post('/ventas-canal', { schema: ventasCanalSchema }, ctrl.ventasCanalHandler)
  fastify.post('/detailsales', { schema: detailSalesSchema }, ctrl.detailSalesHandler)
}
