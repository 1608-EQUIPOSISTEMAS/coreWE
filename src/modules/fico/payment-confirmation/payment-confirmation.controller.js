import * as usecases from './payment-confirmation.usecases.js'
import { toConfirmPaymentDto } from './payment-confirmation.dto.js'

// Adapter HTTP delgado: lee req, delega al usecase, responde con la misma shape
// { ok: true, data } y status 200 del legacy. Sin try/catch: los errores
// inesperados (SP caido) los normaliza el error handler global de buildApp.

export async function confirmPaymentHandler (req, reply) {
  const result = await usecases.confirmPayment({
    ...req.body,
    user_id: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data: toConfirmPaymentDto(result) })
}
