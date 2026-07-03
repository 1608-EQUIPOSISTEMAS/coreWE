import * as usecases from './installment.usecases.js'
import { toResultDto } from './installment.dto.js'

// Adapters HTTP delgados: leen req, delegan al usecase, responden. Sin try/catch
// (los errores los normaliza el error handler global de buildApp via DomainError,
// que preserva el statusCode legacy: 500 para confirm, 400 para edit/add/reschedule).

export async function confirmInstallmentHandler (req, reply) {
  const data = await usecases.confirmInstallment({
    installmentId: req.body.installment_id,
    enrollmentId: req.body.enrollment_id,
    catCurrency: req.body.cat_currency,
    catPaymentMedium: req.body.cat_payment_medium,
    catBusinessEntity: req.body.cat_business_entity,
    bankAccountId: req.body.bank_account_id,
    transactionCode: req.body.transaction_code,
    voucherUrl: req.body.voucher_url,
    paymentDate: req.body.payment_date,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data: toResultDto(data) })
}

export async function editInstallmentAmountHandler (req, reply) {
  const data = await usecases.editInstallmentAmount({
    enrollmentId: req.body.enrollment_id,
    installmentId: req.body.installment_id,
    newAmount: req.body.new_amount,
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data: toResultDto(data) })
}

export async function addInstallmentHandler (req, reply) {
  const data = await usecases.addInstallment({
    enrollmentId: req.body.enrollment_id,
    amount: req.body.amount,
    dueDate: req.body.due_date,
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data: toResultDto(data) })
}

export async function rescheduleInstallmentsHandler (req, reply) {
  const data = await usecases.rescheduleInstallments({
    enrollmentId: req.body.enrollment_id,
    changes: req.body.changes,
    justificacion: req.body.justificacion,
    reasonCode: req.body.reason_code,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data: toResultDto(data) })
}

export async function collectionsHandler (req, reply) {
  const data = await usecases.getCollections(req.body || {})
  return reply.code(200).send({ ok: true, data })
}

export async function syncInstallmentPaymentHandler (req, reply) {
  const data = await usecases.syncInstallmentPaymentToOdoo({
    enrollmentId: req.body.enrollment_id,
    installmentNumber: req.body.installment_number || null
  })
  return reply.code(200).send({ ok: true, data: toResultDto(data) })
}
