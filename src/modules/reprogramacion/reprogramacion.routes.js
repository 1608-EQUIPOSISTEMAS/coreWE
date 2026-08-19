import { authenticate, ALL_FICO, ALL_REPROGRAMACION } from '../../middlewares/auth.hooks.js'
import {
  listSchema,
  destinationsSchema,
  proposeSchema,
  contactSchema,
  verdictSchema
} from './reprogramacion.schemas.js'
import * as ctrl from './reprogramacion.controller.js'

export default async function reprogramacionRoutes (fastify) {
  // Bandeja y seleccion de destino: Academica (y FICO, que necesita verlas).
  fastify.post('/list', { schema: listSchema, preHandler: [authenticate, ALL_REPROGRAMACION] }, ctrl.listHandler)
  fastify.post('/destinations', { schema: destinationsSchema, preHandler: [authenticate, ALL_REPROGRAMACION] }, ctrl.destinationsHandler)
  fastify.post('/propose', { schema: proposeSchema, preHandler: [authenticate, ALL_REPROGRAMACION] }, ctrl.proposeHandler)
  fastify.post('/contact', { schema: contactSchema, preHandler: [authenticate, ALL_REPROGRAMACION] }, ctrl.contactHandler)

  // El veredicto mueve dinero y matriculas: solo FICO firma.
  fastify.post('/accept', { schema: verdictSchema, preHandler: [authenticate, ALL_FICO] }, ctrl.acceptHandler)
  fastify.post('/reject', { schema: verdictSchema, preHandler: [authenticate, ALL_FICO] }, ctrl.rejectHandler)
}
