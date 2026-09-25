import { authenticate, hasRole, ALL_COMERCIAL } from '../../shared/http/auth.middleware.js'
import { objetivosSchema, monthSchema, savePlanSchema } from './plancomercial.schemas.js'
import * as ctrl from './plancomercial.controller.js'

// Los objetivos los fijan el lider comercial y Gerencia; el resto del equipo
// solo los lee en los reportes.
const EDITA_OBJETIVOS = hasRole(['ADMIN', 'GERENCIA', 'LIDER_COMERCIAL'])

export default async function planComercialRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/objetivos', { schema: objetivosSchema, preHandler: ALL_COMERCIAL }, ctrl.objetivosHandler)
  fastify.post('/asesores', { schema: monthSchema, preHandler: ALL_COMERCIAL }, ctrl.asesoresHandler)
  fastify.post('/ventas-diarias', { schema: monthSchema, preHandler: ALL_COMERCIAL }, ctrl.ventasDiariasHandler)
  fastify.post('/plan', { schema: monthSchema, preHandler: EDITA_OBJETIVOS }, ctrl.planHandler)
  fastify.post('/plan/save', { schema: savePlanSchema, preHandler: EDITA_OBJETIVOS }, ctrl.savePlanHandler)
}
