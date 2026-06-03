import * as usecases from './token.usecases.js'

// Adapters HTTP delgados: leen req, delegan al usecase, responden. Sin try/catch
// (los errores los normaliza el error handler global de buildApp via DomainError).

export async function listHandler (req, reply) {
  const data = await usecases.listTokens(req.query)
  return reply.code(200).send({ ok: true, data })
}

export async function getByIdHandler (req, reply) {
  const data = await usecases.getToken(Number(req.params.id))
  return reply.code(200).send({ ok: true, data })
}

export async function statsHandler (req, reply) {
  const data = await usecases.getStats()
  return reply.code(200).send({ ok: true, data })
}

export async function createHandler (req, reply) {
  const data = await usecases.createToken({
    leadId: req.body.lead_id,
    enrollmentId: req.body.enrollment_id,
    catProvider: req.body.cat_provider,
    paymentType: req.body.payment_type,
    amount: req.body.amount,
    currency: req.body.currency,
    paymentUrl: req.body.payment_url,
    notes: req.body.notes,
    advisorObservation: req.body.advisor_observation,
    expirationDate: req.body.expiration_date,
    catPaymentChannel: req.body.cat_payment_channel,
    inscriptionData: req.body.inscription_data,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function updateHandler (req, reply) {
  const data = await usecases.updateToken({
    tokenId: req.body.token_id,
    paymentUrl: req.body.payment_url,
    providerReference: req.body.provider_reference,
    notes: req.body.notes,
    expirationDate: req.body.expiration_date,
    catProvider: req.body.cat_provider,
    amount: req.body.amount,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function markPaidHandler (req, reply) {
  const data = await usecases.markTokenPaid({
    tokenId: req.body.token_id,
    providerReference: req.body.provider_reference,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function confirmHandler (req, reply) {
  const data = await usecases.confirmToken({
    tokenId: req.body.token_id,
    providerReference: req.body.provider_reference,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function deleteHandler (req, reply) {
  const data = await usecases.deleteToken({ tokenId: Number(req.params.id) })
  return reply.code(200).send({ ok: true, data })
}

export async function groupHandler (req, reply) {
  const data = await usecases.groupTokens({
    tokenIds: req.body.token_ids,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function editInscriptionHandler (req, reply) {
  const data = await usecases.editTokenInscription({
    tokenId: req.body.token_id,
    inscription: req.body.inscription,
    amount: req.body.amount,
    currency: req.body.currency,
    paymentType: req.body.payment_type,
    catPaymentChannel: req.body.cat_payment_channel,
    advisorObservation: req.body.advisor_observation,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function ungroupHandler (req, reply) {
  const data = await usecases.ungroupTokens({
    groupId: req.body.group_id,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, data })
}
