import * as usecases from './catalog.usecases.js'

export async function catalogListHandler (req, reply) {
  const data = await usecases.getCatalog()
  return reply.code(200).send({ ok: true, data })
}

export async function membershipListHandler (req, reply) {
  const { active, q, page, size } = req.body || {}
  const data = await usecases.getMembershipList({ active, q, page, size })
  return reply.code(200).send({ ok: true, data })
}
