import { authenticate, hasRole } from '../../shared/http/auth.middleware.js'
import {
  dashboardListSchema,
  programGoalsSchema,
  programGoalsSaveSchema,
  goalHistorySchema,
  goalStandardsSchema,
  goalStandardsSaveSchema,
  goalStandardsApplySchema,
  gerenciaFunnelSchema,
  leadsPerEditionSchema,
  targetRegisterSchema,
  detailLeadsSchema,
  contactabilitySchema,
  liderSchema,
  availableWeeksSchema,
  ventasCanalSchema,
  detailSalesSchema,
  teamSummarySchema,
  dailyPlanSchema
} from './dashboard.schemas.js'
import * as ctrl from './dashboard.controller.js'

export default async function dashboardRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/admin-summary', { preHandler: hasRole(['ADMIN', 'GERENCIA']) }, ctrl.adminSummaryHandler)
  // Sin gate de rol a proposito: todo usuario autenticado tiene panel. Que ve
  // (su area o solo lo suyo) lo decide teamScopeFor con los roles del token.
  fastify.post('/team-summary', { schema: teamSummarySchema }, ctrl.teamSummaryHandler)
  // Plan del dia con IA: se genera de madrugada (services/daily-plan.cron.js) y
  // aqui solo se lee. Que plan ve cada quien lo decide getDailyPlan con los
  // roles del token; regenerar lo puede solo el lider de esa area (o ADMIN).
  fastify.post('/daily-plan', { schema: dailyPlanSchema }, ctrl.dailyPlanHandler)
  fastify.post('/daily-plan/regenerate', { schema: dailyPlanSchema }, ctrl.dailyPlanRegenerateHandler)
  fastify.post('/dashboardlist', { schema: dashboardListSchema }, ctrl.dashboardListHandler)
  // Lo ve tambien LIDER_COMERCIAL: ve el modulo entero, aunque solo edite lo suyo.
  fastify.post('/program-goals', { schema: programGoalsSchema }, ctrl.programGoalsHandler)
  // El lider comercial guarda por la MISMA ruta que Gerencia: el usecase le
  // recorta el cambio a las ventas de sus canales. Dejarlo fuera del gate seria
  // fiarse de que la pantalla no mande de mas.
  fastify.post('/program-goals/save', { schema: programGoalsSaveSchema, preHandler: hasRole(['ADMIN', 'GERENCIA', 'LIDER_COMERCIAL']) }, ctrl.programGoalsSaveHandler)
  fastify.post('/goal-history', { schema: goalHistorySchema }, ctrl.goalHistoryHandler)
  // Gerencia > Parametros: el estandar por programa. Guardar YA lo baja a las
  // ediciones futuras, asi que es la misma potestad que editar el objetivo.
  fastify.post('/goal-standards', { schema: goalStandardsSchema, preHandler: hasRole(['ADMIN', 'GERENCIA']) }, ctrl.goalStandardsHandler)
  fastify.post('/goal-standards/save', { schema: goalStandardsSaveSchema, preHandler: hasRole(['ADMIN', 'GERENCIA']) }, ctrl.goalStandardsSaveHandler)
  fastify.post('/goal-standards/apply', { schema: goalStandardsApplySchema, preHandler: hasRole(['ADMIN', 'GERENCIA']) }, ctrl.goalStandardsApplyHandler)
  fastify.post('/gerencia-funnel', { schema: gerenciaFunnelSchema, preHandler: hasRole(['ADMIN', 'GERENCIA']) }, ctrl.gerenciaFunnelHandler)
  fastify.post('/leads-per-edition', { schema: leadsPerEditionSchema }, ctrl.leadsPerEditionHandler)
  fastify.post('/dashboardtargetregister', { schema: targetRegisterSchema }, ctrl.targetRegisterHandler)
  fastify.post('/detailleads', { schema: detailLeadsSchema }, ctrl.detailLeadsHandler)
  fastify.post('/contactability', { schema: contactabilitySchema }, ctrl.contactabilityHandler)
  fastify.post('/lider', { schema: liderSchema }, ctrl.liderHandler)
  fastify.post('/available-weeks', { schema: availableWeeksSchema }, ctrl.availableWeeksHandler)
  fastify.post('/ventas-canal', { schema: ventasCanalSchema }, ctrl.ventasCanalHandler)
  fastify.post('/detailsales', { schema: detailSalesSchema }, ctrl.detailSalesHandler)
}
