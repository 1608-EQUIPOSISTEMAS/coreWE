import { authenticate, hasRole, ALL_COMERCIAL, ADMIN_ONLY } from '../../shared/http/auth.middleware.js'
import { fichaSchema, bandejaSchema, resultadoSchema, seguimientoSchema, manualSchema } from './prediccion.schemas.js'
import * as ctrl from './prediccion.controller.js'

// La medicion (¿la bandeja hace vender mas?) es para quien decide, no para el asesor.
const LIDERES = hasRole(['ADMIN', 'LIDER_COMERCIAL', 'GERENCIA'])

export default async function prediccionRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/ficha', { schema: fichaSchema, preHandler: ALL_COMERCIAL }, ctrl.fichaHandler)
  // Manual de venta para un numero nuevo: que suelen hacer los que preguntan por X.
  fastify.post('/programas', { preHandler: ALL_COMERCIAL }, ctrl.programasHandler)
  fastify.post('/programa', { schema: manualSchema, preHandler: ALL_COMERCIAL }, ctrl.manualHandler)
  fastify.post('/bandeja', { schema: bandejaSchema, preHandler: ALL_COMERCIAL }, ctrl.bandejaHandler)
  fastify.post('/bandeja/resultado', { schema: resultadoSchema, preHandler: ALL_COMERCIAL }, ctrl.resultadoHandler)
  // Cadencia asistida: el asesor marca que mando el mensaje del dia.
  fastify.post('/bandeja/seguimiento', { schema: seguimientoSchema, preHandler: ALL_COMERCIAL }, ctrl.seguimientoHandler)
  fastify.post('/bandeja/medicion', { preHandler: LIDERES }, ctrl.medicionHandler)
  // La genera el cron de madrugada; el boton manual es para el admin (deploy, prueba).
  fastify.post('/bandeja/generar', { preHandler: ADMIN_ONLY }, ctrl.generarHandler)
}
