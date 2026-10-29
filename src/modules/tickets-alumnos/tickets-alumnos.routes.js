import { authenticate, ALL_TICKETS } from '../../middlewares/auth.hooks.js'
import { listSchema, firmaSchema, archivoSchema, seguimientoSchema } from './tickets-alumnos.schemas.js'
import * as ctrl from './tickets-alumnos.controller.js'

export default async function ticketsRoutes (fastify) {
  // Las dos areas entran a todos los endpoints: quien puede FIRMAR cada tramite
  // lo decide assertPuedeFirmar contra el paso actual, no el gate de la ruta.
  // Un gate por area aca seria mentira — el mismo endpoint sirve al paso de
  // Academica y al de FICO segun en que punto este el ticket.
  fastify.post('/list', { schema: listSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.listHandler)
  fastify.post('/firmar', { schema: firmaSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.firmarHandler)
  fastify.post('/rechazar', { schema: firmaSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.rechazarHandler)
  // Seguimiento: quien toma el tramite, quien lo suelta y la bitacora completa.
  fastify.post('/tomar', { schema: seguimientoSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.tomarHandler)
  fastify.post('/liberar', { schema: seguimientoSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.liberarHandler)
  fastify.post('/historial', { schema: seguimientoSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.historialHandler)
  fastify.post('/archivo', { schema: archivoSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.archivoHandler)
}
