import { authenticate } from '../../../shared/http/auth.middleware.js'
import {
  sendConfirmationEmailSchema,
  sendPaymentConfirmationEmailSchema,
  previewEmailSchema,
  emailLogsSchema
} from './email-confirmation.schemas.js'
import * as ctrl from './email-confirmation.controller.js'

// Correos transaccionales FICO. Paridad con routes/fico.js: las cuatro rutas
// solo exigen authenticate (sin gate de rol), igual que el legacy.
export default async function emailConfirmationRoutes (fastify) {
  fastify.post('/sendconfirmationemail', { preHandler: [authenticate], schema: sendConfirmationEmailSchema }, ctrl.sendConfirmationEmailHandler)
  fastify.post('/sendpaymentconfirmationemail', { preHandler: [authenticate], schema: sendPaymentConfirmationEmailSchema }, ctrl.sendPaymentConfirmationEmailHandler)
  fastify.post('/previewemail', { preHandler: [authenticate], schema: previewEmailSchema }, ctrl.previewEmailHandler)
  fastify.post('/emaillogs', { preHandler: [authenticate], schema: emailLogsSchema }, ctrl.emailLogsHandler)
}
