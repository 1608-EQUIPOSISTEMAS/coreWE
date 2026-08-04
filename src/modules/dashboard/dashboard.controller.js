import * as usecases from './dashboard.usecases.js'

export async function adminSummaryHandler (req, reply) {
  const data = await usecases.adminSummary()
  return reply.send({ ok: true, data })
}

export async function dashboardListHandler (req, reply) {
  const data = await usecases.dashboardList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function programGoalsHandler (req, reply) {
  const data = await usecases.programGoalsList(req.body)
  return reply.send({ ok: true, data })
}

export async function gerenciaFunnelHandler (req, reply) {
  const data = await usecases.gerenciaFunnelList(req.body)
  return reply.send({ ok: true, data })
}

export async function programGoalsSaveHandler (req, reply) {
  const data = await usecases.saveProgramGoals({ goals: req.body.goals, userId: req.user.id })
  return reply.send({ ok: true, data })
}

export async function leadsPerEditionHandler (req, reply) {
  const data = await usecases.leadsPerEdition(req.body)
  return reply.send({ ok: true, data })
}

export async function targetRegisterHandler (req, reply) {
  const { target_id } = await usecases.dashboardTargetRegister(req.body)
  return reply.code(201).send({ ok: true, target_id })
}

export async function detailLeadsHandler (req, reply) {
  const { data, page, size } = await usecases.detailLeads(req.body)
  return reply.send({ ok: true, data, page, size })
}

export async function contactabilityHandler (req, reply) {
  const data = await usecases.contactabilityList(req.body)
  return reply.send({ ok: true, data })
}

export async function liderHandler (req, reply) {
  const data = await usecases.liderList(req.body)
  return reply.send({ ok: true, data })
}

export async function availableWeeksHandler (req, reply) {
  const data = await usecases.availableWeeks(req.body)
  return reply.send({ ok: true, data })
}

export async function ventasCanalHandler (req, reply) {
  const data = await usecases.ventasCanalList(req.body)
  return reply.send({ ok: true, data })
}

export async function detailSalesHandler (req, reply) {
  const { data, page, size } = await usecases.detailSales(req.body)
  return reply.send({ ok: true, data, page, size })
}
