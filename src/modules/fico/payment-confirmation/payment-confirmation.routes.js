import { authenticate } from '../../../shared/http/auth.middleware.js'
import { confirmPaymentSchema } from './payment-confirmation.schemas.js'
import * as ctrl from './payment-confirmation.controller.js'

// Rutas del subdominio FICO payment-confirmation. El gate de rol del legacy era
// solo authenticate (sin hasRole) para POST /confirmpayment; se preserva igual.
export default async function paymentConfirmationRoutes (fastify) {
  fastify.post('/confirmpayment', {
    preHandler: [authenticate],
    schema: confirmPaymentSchema
  }, ctrl.confirmPaymentHandler)
}
