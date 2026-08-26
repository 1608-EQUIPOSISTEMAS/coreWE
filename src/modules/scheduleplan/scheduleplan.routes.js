import { authenticate, ALL_PRODUCTO, ADMIN_PRODUCTO } from '../../shared/http/auth.middleware.js'
import {
  planListSchema,
  planGetSchema,
  planCreateSchema,
  planSaveSchema,
  planDeleteSchema,
  planSeedSchema,
  planSeedYearSchema,
  planPreviewSchema,
  planPublishSchema
} from './scheduleplan.schemas.js'
import * as ctrl from './scheduleplan.controller.js'

export default async function schedulePlanRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  // Armar y mover escenarios es trabajo de Producto: no escribe nada real.
  fastify.post('/planlist', { schema: planListSchema, preHandler: ALL_PRODUCTO }, ctrl.listHandler)
  fastify.post('/planget', { schema: planGetSchema, preHandler: ALL_PRODUCTO }, ctrl.getHandler)
  fastify.post('/plancreate', { schema: planCreateSchema, preHandler: ALL_PRODUCTO }, ctrl.createHandler)
  // El planner manda el escenario COMPLETO en cada guardado. Con el anio entero
  // (500+ ediciones) eso se pasa del bodyLimit de Fastify (1 MB por defecto) y
  // el POST muere con 413 antes de llegar al handler: el usuario solo veia
  // "no se pudo guardar el plan". Los items ya viajan podados
  // (scheduleplan.entity.js), este margen es para que el limite no vuelva a
  // aparecer cuando el plan crezca.
  fastify.post('/plansave', {
    schema: planSaveSchema,
    preHandler: ALL_PRODUCTO,
    bodyLimit: 16 * 1024 * 1024
  }, ctrl.saveHandler)
  fastify.post('/plandelete', { schema: planDeleteSchema, preHandler: ALL_PRODUCTO }, ctrl.deleteHandler)

  // Copiar el anio anterior recorre 1 mes del cronograma real + 1 consulta por
  // paquete: con meses cargados pasa del timeout por defecto.
  fastify.post('/planseed', {
    schema: planSeedSchema,
    preHandler: ALL_PRODUCTO,
    config: { timeout: 120000 }
  }, ctrl.seedHandler)

  // Los 12 meses de una: es la forma normal de arrancar un plan.
  fastify.post('/planseedyear', {
    schema: planSeedYearSchema,
    preHandler: ALL_PRODUCTO,
    config: { timeout: 600000 }
  }, ctrl.seedYearHandler)

  fastify.post('/planpreview', { schema: planPreviewSchema, preHandler: ALL_PRODUCTO }, ctrl.previewHandler)

  // Publicar es lo unico que escribe en program_editions. Se reserva a quien ya
  // puede crear ediciones a mano en el cronograma real.
  fastify.post('/planpublish', {
    schema: planPublishSchema,
    preHandler: ADMIN_PRODUCTO,
    config: { timeout: 300000 }
  }, ctrl.publishHandler)
}
