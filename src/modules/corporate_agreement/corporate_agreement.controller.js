import * as usecases from './corporate_agreement.usecases.js'

export async function registerHandler (req, reply) {
  const { agreement_id, data } = await usecases.registerAgreement(req.body)
  return reply.code(201).send({ ok: true, agreement_id, data })
}

export async function listHandler (req, reply) {
  const data = await usecases.listAgreements(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function callerHandler (req, reply) {
  const items = await usecases.callerAgreements(req.body)
  return reply.code(200).send({ ok: true, items })
}

export async function updateHandler (req, reply) {
  const { agreement_id, data } = await usecases.updateAgreement(req.body)
  return reply.code(200).send({ ok: true, agreement_id, data })
}
