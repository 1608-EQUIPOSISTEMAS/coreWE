import { authenticate, ALL_PRODUCTO, ALL_COMERCIAL, PRODUCTO_COMERCIAL } from '../../shared/http/auth.middleware.js'
import {
  programRegisterSchema,
  programListSchema,
  programGetSchema,
  programUpdateSchema,
  programVersionCallerSchema,
  priceListSchema,
  programVersionListSchema,
  programVersionUpdateSchema,
  programCallerSchema,
  programVersionDetailGetSchema,
  eventCategoryListSchema,
  programMediaGetSchema,
  programMediaSlotSchema
} from './program.schemas.js'
import * as ctrl from './program.controller.js'
import productReportRoutes from './report/report.routes.js'

export default async function programRoutes (fastify) {
  fastify.post('/programregister', { schema: programRegisterSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.registerHandler)
  fastify.post('/programlist', { schema: programListSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.listHandler)
  fastify.post('/programget', { schema: programGetSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.getHandler)
  fastify.post('/programupdate', { schema: programUpdateSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.updateHandler)
  fastify.post('/programversioncaller', { schema: programVersionCallerSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.versionCallerHandler)
  fastify.post('/pricelist', { schema: priceListSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.priceListHandler)
  fastify.post('/programversionlist', { schema: programVersionListSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.versionListHandler)
  fastify.post('/programversionupdate', { schema: programVersionUpdateSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.versionUpdateHandler)
  fastify.post('/programcaller', { schema: programCallerSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.callerHandler)
  // PRODUCTO_COMERCIAL y no ALL_COMERCIAL: nacio para el form de Comercial, pero
  // FICO tambien inscribe a eventos desde /fico/inscripciones/new y ALL_COMERCIAL
  // deja fuera a FICO/LIDER_FICO — el select de categoria salia vacio con un 403
  // que el front solo logueaba en consola. Es el mismo gate que las demas rutas
  // de lectura de programa que ese formulario ya consume.
  fastify.post('/eventcategorylist', { schema: eventCategoryListSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.eventCategoryListHandler)
  fastify.post('/programversiondetailget', { schema: programVersionDetailGetSchema, preHandler: [authenticate, ALL_COMERCIAL] }, ctrl.versionDetailGetHandler)
  // Archivos del programa que manda el bot de WhatsApp: los sube Producto; Comercial
  // (Líder, que opera el bot) los puede ver. La subida es multipart: sin schema AJV.
  fastify.post('/programmediaget', { schema: programMediaGetSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.mediaGetHandler)
  fastify.post('/programmediafile', { schema: programMediaSlotSchema, preHandler: [authenticate, PRODUCTO_COMERCIAL] }, ctrl.mediaFileHandler)
  fastify.post('/programmediaupload', { preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.mediaUploadHandler)
  fastify.post('/programmediadelete', { schema: programMediaSlotSchema, preHandler: [authenticate, ALL_PRODUCTO] }, ctrl.mediaDeleteHandler)
  await fastify.register(productReportRoutes)
}
