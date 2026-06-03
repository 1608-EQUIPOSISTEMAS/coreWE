import * as usecases from './customer.usecases.js'

export async function registerHandler (req, reply) {
  const { customer_id } = await usecases.registerCustomer(req.body)
  return reply.code(201).send({ ok: true, customer_id })
}

export async function listHandler (req, reply) {
  const data = await usecases.listCustomers(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function getHandler (req, reply) {
  const data = await usecases.getCustomer(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function infoGetHandler (req, reply) {
  const data = await usecases.customerInfoGet(req.body)
  return reply.code(200).send({ ok: data.result === 1, data })
}

export async function updateHandler (req, reply) {
  const { customer_id } = await usecases.updateCustomer(req.body)
  return reply.code(200).send({ ok: true, customer_id })
}

export async function callerHandler (req, reply) {
  const data = await usecases.callerCustomers(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function sunatGetHandler (req, reply) {
  const data = await usecases.sunatLookup(req.body)
  return reply.code(200).send({ ok: true, data })
}
