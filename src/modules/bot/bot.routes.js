import { authenticate, ALL_ACADEMICA } from '../../shared/http/auth.middleware.js'
import {
  botTicketListSchema,
  botTicketGetSchema,
  botTicketUpdateSchema,
  botDashboardMetricsSchema,
  botStudentListSchema,
  botStudentGetSchema,
  botCsatListSchema,
  botAdvisorListSchema
} from './bot.schemas.js'
import * as ctrl from './bot.controller.js'

export default async function botRoutes (fastify) {
  fastify.post('/botticketlist', { schema: botTicketListSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.ticketListHandler)
  fastify.post('/botticketget', { schema: botTicketGetSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.ticketGetHandler)
  fastify.post('/botticketupdate', { schema: botTicketUpdateSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.ticketUpdateHandler)
  fastify.post('/botdashboardmetrics', { schema: botDashboardMetricsSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.dashboardMetricsHandler)
  fastify.post('/botstudentlist', { schema: botStudentListSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.studentListHandler)
  fastify.post('/botstudentget', { schema: botStudentGetSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.studentGetHandler)
  fastify.post('/botcsatlist', { schema: botCsatListSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.csatListHandler)
  fastify.post('/botadvisorlist', { schema: botAdvisorListSchema, preHandler: [authenticate, ALL_ACADEMICA] }, ctrl.advisorListHandler)
}
