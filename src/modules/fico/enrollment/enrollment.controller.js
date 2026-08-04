import * as usecases from './enrollment.usecases.js'

// Adapters HTTP delgados: leen req, delegan al usecase, responden { ok, data }.
// Sin try/catch: el error handler global de buildApp normaliza DomainError /
// NotFoundError al status correcto, preservando el shape { ok:false, error } que
// devolvia el service legacy.

export async function enrollmentRegisterHandler (req, reply) {
  const data = await usecases.ficoEnrollmentRegister({
    data: req.body.inscription,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function refreshListHandler (req, reply) {
  const data = await usecases.refreshEnrollmentList()
  return reply.code(200).send({ ok: true, data })
}

export async function enrollmentListHandler (req, reply) {
  const data = await usecases.enrollmentList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function enrollmentAdvisorsHandler (req, reply) {
  const data = await usecases.enrollmentAdvisorsList()
  return reply.code(200).send({ ok: true, data })
}

export async function jobStatusHandler (req, reply) {
  const data = await usecases.getLatestJob({
    enrollmentId: parseInt(req.params.enrollmentId),
    jobType: req.query.jobType || null
  })
  return reply.code(200).send({ ok: true, data: data || null })
}

export async function kpisDailyHandler (req, reply) {
  const data = await usecases.getKpisDaily({
    today: req.query.today,
    yesterday: req.query.yesterday
  })
  return reply.code(200).send({ ok: true, data })
}

export async function bankAccountsHandler (req, reply) {
  const data = await usecases.bankAccountList()
  return reply.code(200).send({ ok: true, data })
}

export async function paymentDetailGetHandler (req, reply) {
  const data = await usecases.paymentDetailGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function enrollmentUpdateHandler (req, reply) {
  const data = await usecases.enrollmentUpdate({
    enrollmentId: req.body.enrollment_id,
    fields: req.body.fields || {},
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function availableEditionsHandler (req, reply) {
  const data = await usecases.getAvailableEditions({ enrollmentId: req.body.enrollment_id })
  return reply.code(200).send({ ok: true, data })
}

export async function programPriceHandler (req, reply) {
  const data = await usecases.getProgramPrice({ programVersionId: req.body.program_version_id })
  return reply.code(200).send({ ok: true, data })
}

export async function retireEnrollmentHandler (req, reply) {
  const data = await usecases.retireEnrollment({
    enrollmentId: req.body.enrollment_id,
    reason: req.body.reason,
    hasRefund: req.body.has_refund || false,
    refundAmount: req.body.refund_amount || 0,
    justificacion: req.body.justificacion || req.body.reason,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function deleteEnrollmentHandler (req, reply) {
  const data = await usecases.deleteEnrollment({
    enrollmentId: req.body.enrollment_id,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function enrollmentFlagsHandler (req, reply) {
  const data = await usecases.getEnrollmentFlags({ enrollmentId: req.body.enrollment_id })
  return reply.code(200).send({ ok: true, data })
}

export async function editStudentHandler (req, reply) {
  const data = await usecases.editStudent({
    enrollmentId: req.body.enrollment_id,
    firstName: req.body.first_name,
    lastName: req.body.last_name,
    documentNumber: req.body.document_number,
    originEmail: req.body.origin_email,
    originPhone: req.body.origin_phone,
    odooEmail: req.body.odoo_email,
    newProfileId: req.body.cat_profile_id,
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function changeModalityHandler (req, reply) {
  const data = await usecases.changeModality({
    enrollmentId: req.body.enrollment_id,
    newModalityId: req.body.new_modality_id,
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function editSellerAgentHandler (req, reply) {
  const data = await usecases.editSellerAgent({
    enrollmentId: req.body.enrollment_id,
    newSellerAgentId: req.body.new_seller_agent_id ?? null,
    newAgentOrigin: req.body.new_agent_origin === undefined ? undefined : req.body.new_agent_origin,
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function courseChangeHandler (req, reply) {
  const data = await usecases.courseChange({
    enrollmentId: req.body.enrollment_id,
    newProgramVersionId: req.body.new_program_version_id,
    newEditionId: req.body.new_edition_id,
    totalAmount: req.body.total_amount,
    justificacion: req.body.justificacion,
    userId: req.user?.id ?? req.body.user_id,
    cat_currency: req.body.cat_currency,
    cat_method_payment: req.body.cat_method_payment,
    cat_business_entity: req.body.cat_business_entity,
    bank_account_id: req.body.bank_account_id,
    transaction_code: req.body.transaction_code,
    ticket_payment_urls: req.body.ticket_payment_urls
  })
  return reply.code(200).send({ ok: true, data })
}

export async function reprogramEditionHandler (req, reply) {
  const data = await usecases.reprogramEdition({
    enrollmentId: req.body.enrollment_id,
    newEditionId: req.body.new_edition_id,
    justificacion: req.body.justificacion,
    installmentPlan: req.body.installment_plan ?? null,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function approvePendingReviewHandler (req, reply) {
  const data = await usecases.approvePendingReview({
    enrollmentId: req.body.enrollment_id,
    userId: req.user?.id ?? req.body.user_id,
    activationDate: req.body.activation_date ?? null
  })
  return reply.code(200).send({ ok: true, data })
}

export async function rejectEnrollmentHandler (req, reply) {
  const data = await usecases.rejectEnrollment({
    enrollmentId: req.body.enrollment_id,
    reason: req.body.reason,
    clearCcRequirement: req.body.clear_cc_requirement === true,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function resubmitEnrollmentHandler (req, reply) {
  const data = await usecases.resubmitEnrollment({
    enrollmentId: req.body.enrollment_id,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}
