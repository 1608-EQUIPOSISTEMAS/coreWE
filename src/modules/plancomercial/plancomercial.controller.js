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

export async function recompraHandler (req, reply) {
  const data = await usecases.recompraDelAnio(req.body)
  return reply.send({ ok: true, data })
}

export async function productosHandler (req, reply) {
  const data = await usecases.productosDelMes(req.body)
  return reply.send({ ok: true, data })
}

export async function anualHandler (req, reply) {
  const data = await usecases.anualComercial(req.body)
  return reply.send({ ok: true, data })
}

export async function estrategiasHandler (req, reply) {
  const data = await usecases.estrategiasDelMes(req.body)
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

export async function reporteHandler (req, reply) {
  const data = await usecases.reporteComercial(req.body)
  return reply.send({ ok: true, data })
}
