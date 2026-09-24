import { authenticate, ALL_TICKETS } from '../../middlewares/auth.hooks.js'
import { listSchema, firmaSchema, archivoSchema } from './tickets-alumnos.schemas.js'
import * as ctrl from './tickets-alumnos.controller.js'

export default async function ticketsRoutes (fastify) {
  // Las dos areas entran a todos los endpoints: quien puede FIRMAR cada tramite
  // lo decide assertPuedeFirmar contra el paso actual, no el gate de la ruta.
  // Un gate por area aca seria mentira — el mismo endpoint sirve al paso de
  // Academica y al de FICO segun en que punto este el ticket.
  fastify.post('/list', { schema: listSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.listHandler)
  fastify.post('/firmar', { schema: firmaSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.firmarHandler)
  fastify.post('/rechazar', { schema: firmaSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.rechazarHandler)
  fastify.post('/archivo', { schema: archivoSchema, preHandler: [authenticate, ALL_TICKETS] }, ctrl.archivoHandler)
}
