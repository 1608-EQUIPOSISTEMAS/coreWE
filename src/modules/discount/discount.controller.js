import * as usecases from './discount.usecases.js'

export async function registerHandler (req, reply) {
  const { discount_id } = await usecases.registerDiscount(req.body)
  return reply.code(201).send({ ok: true, discount_id })
}

export async function listHandler (req, reply) {
  const data = await usecases.listDiscounts(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function getHandler (req, reply) {
  const { data } = await usecases.getDiscount(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function updateHandler (req, reply) {
  const { discount_id } = await usecases.updateDiscount(req.body)
  return reply.code(200).send({ ok: true, discount_id })
}

export async function callerHandler (req, reply) {
  const data = await usecases.callerDiscounts(req.body)
  return reply.code(200).send({ ok: true, data })
}
