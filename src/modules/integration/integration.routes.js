import { authenticate } from '../../shared/http/auth.middleware.js'
import {
  syncLeadsToSheetSchema,
  syncInscToSheetSchema,
  syncScheduleToSheetSchema,
  syncRprospectosSchema,
  syncEnrollmentToSheetSchema,
  syncFicoSalesToSheetSchema,
  syncFicoToSheetsSchema,
  sendSlackReportSchema
} from './integration.schemas.js'
import * as ctrl from './integration.controller.js'

export default async function integrationRoutes (fastify) {
  fastify.post('/syncleadstosheet', { schema: syncLeadsToSheetSchema, preHandler: [authenticate] }, ctrl.syncLeadsToSheetHandler)
  fastify.post('/syncInscToSheet', { schema: syncInscToSheetSchema, preHandler: [authenticate] }, ctrl.syncInscToSheetHandler)
  fastify.post('/syncscheduletosheet', { schema: syncScheduleToSheetSchema, preHandler: [authenticate] }, ctrl.syncScheduleToSheetHandler)
  fastify.post('/syncrprospectos', { schema: syncRprospectosSchema, preHandler: [authenticate] }, ctrl.syncRprospectosHandler)
  fastify.post('/syncEnrollmentToSheet', { schema: syncEnrollmentToSheetSchema, preHandler: [authenticate] }, ctrl.syncEnrollmentToSheetHandler)
  fastify.post('/syncFicoSalesToSheet', { schema: syncFicoSalesToSheetSchema, preHandler: [authenticate] }, ctrl.syncFicoSalesToSheetHandler)
  fastify.post('/syncFicoToSheets', { schema: syncFicoToSheetsSchema, preHandler: [authenticate] }, ctrl.syncFicoToSheetsHandler)
  fastify.post('/send-slack-report', { schema: sendSlackReportSchema, preHandler: [authenticate] }, ctrl.sendSlackReportHandler)
}
