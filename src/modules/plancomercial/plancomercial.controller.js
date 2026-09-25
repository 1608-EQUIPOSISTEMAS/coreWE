import * as usecases from './plancomercial.usecases.js'

export async function objetivosHandler (req, reply) {
  const data = await usecases.objetivosDelAnio(req.body)
  return reply.send({ ok: true, data })
}

export async function asesoresHandler (req, reply) {
  const data = await usecases.asesoresDelMes(req.body)
  return reply.send({ ok: true, data })
}

export async function ventasDiariasHandler (req, reply) {
  const data = await usecases.ventasDiarias(req.body)
  return reply.send({ ok: true, data })
}

export async function planHandler (req, reply) {
  const data = await usecases.planDelMes(req.body)
  return reply.send({ ok: true, data })
}

export async function savePlanHandler (req, reply) {
  const data = await usecases.guardarPlanDelMes({ ...req.body, userId: req.user.id })
  return reply.send({ ok: true, data })
}
