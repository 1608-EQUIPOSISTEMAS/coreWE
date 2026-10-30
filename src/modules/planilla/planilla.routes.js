import { authenticate, hasRole } from '../../middlewares/auth.hooks.js'
import { periodoSchema, justificarSchema, actualizarPersonalSchema } from './planilla.schemas.js'
import * as ctrl from './planilla.controller.js'

// Modulo exclusivo de Talento. ADMIN entra para dar soporte (asistencia,
// importaciones) pero los montos los corta la entity: sueldos, planilla,
// exportacion y cierre responden 403 a quien no tenga el rol TALENTO.
// Gate por rol y no por matriz: la matriz le da todo a ADMIN y aca no se quiere
// que un permiso marcado por error exponga sueldos.
const PLANILLA = hasRole(['TALENTO', 'ADMIN'])
const pre = [authenticate, PLANILLA]

export default async function planillaRoutes (fastify) {
  fastify.get('/personal', { preHandler: pre }, ctrl.personalHandler)
  fastify.post('/personal/importar', { preHandler: pre }, ctrl.importarPersonalHandler)
  fastify.patch('/personal/:id', { schema: actualizarPersonalSchema, preHandler: pre }, ctrl.actualizarPersonalHandler)
  fastify.get('/personal/plantilla', { preHandler: pre }, ctrl.plantillaHandler)

  fastify.post('/huellero/importar', { preHandler: pre }, ctrl.importarHuelleroHandler)
  fastify.get('/importaciones', { preHandler: pre }, ctrl.importacionesHandler)

  fastify.post('/asistencia', { schema: periodoSchema, preHandler: pre }, ctrl.asistenciaHandler)
  fastify.post('/asistencia/justificar', { schema: justificarSchema, preHandler: pre }, ctrl.justificarHandler)

  fastify.post('/calculo', { schema: periodoSchema, preHandler: pre }, ctrl.planillaHandler)
  fastify.post('/exportar', { schema: periodoSchema, preHandler: pre }, ctrl.exportarHandler)
  fastify.post('/periodo/cerrar', { schema: periodoSchema, preHandler: pre }, ctrl.cerrarHandler)
  fastify.post('/periodo/reabrir', { schema: periodoSchema, preHandler: pre }, ctrl.reabrirHandler)
}
