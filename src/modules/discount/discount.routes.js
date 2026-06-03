import { authenticate, ADMIN_COMERCIAL } from '../../shared/http/auth.middleware.js'
import {
  discountRegisterSchema,
  discountListSchema,
  discountGetSchema,
  discountUpdateSchema,
  discountCallerSchema
} from './discount.schemas.js'
import * as ctrl from './discount.controller.js'

// Gate de autorizacion del modulo. La ruta legacy aplica solo authenticate global;
// los preHandler de rol estan comentados, por lo que se preserva ese mismo gate
// para no introducir una regresion de comportamiento. Reactivar ADMIN_COMERCIAL
// (descomentando los preHandler) requiere validacion funcional previa.
export default async function discountRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/discountregister', {
    schema: discountRegisterSchema
    // preHandler: [authenticate, ADMIN_COMERCIAL]
  }, ctrl.registerHandler)

  fastify.post('/discountlist', {
    schema: discountListSchema
    // preHandler: [authenticate, ADMIN_COMERCIAL]
  }, ctrl.listHandler)

  fastify.post('/discountget', {
    schema: discountGetSchema
    // preHandler: [authenticate, ADMIN_COMERCIAL]
  }, ctrl.getHandler)

  fastify.post('/discountupdate', {
    schema: discountUpdateSchema
    // preHandler: [authenticate, ADMIN_COMERCIAL]
  }, ctrl.updateHandler)

  fastify.post('/discountcaller', {
    schema: discountCallerSchema
    // preHandler: [authenticate, ADMIN_COMERCIAL]
  }, ctrl.callerHandler)
}
