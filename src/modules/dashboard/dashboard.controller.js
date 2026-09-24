import * as usecases from './dashboard.usecases.js'
import * as standards from './goal-standards/goal-standards.usecases.js'
import { getDailyPlan, regenerableAreas, startDailyPlanGeneration } from './daily-plan/daily-plan.usecases.js'
import { ForbiddenError } from '../../shared/errors.js'

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
  // Los roles viajan por dos reglas que vivien en el usecase: la ventana de
  // edicion (ADMIN la saltea) y cuanto puede tocar cada rol (el lider comercial,
  // solo las ventas de sus canales).
  const data = await usecases.saveProgramGoals({ goals: req.body.goals, userId: req.user.id, roles: req.user.roles })
  return reply.send({ ok: true, data })
}

export async function goalHistoryHandler (req, reply) {
  const data = await usecases.goalHistoryList(req.body)
  return reply.send({ ok: true, data })
}

export async function goalStandardsHandler (req, reply) {
  const data = await standards.goalStandardsList(req.body)
  return reply.send({ ok: true, data })
}

export async function goalStandardsSaveHandler (req, reply) {
  const data = await standards.saveGoalStandards({ ...req.body, userId: req.user.id })
  return reply.send({ ok: true, data })
}

export async function goalStandardsApplyHandler (req, reply) {
  const data = await standards.applyGoalStandards({ userId: req.user.id })
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

export async function teamSummaryHandler (req, reply) {
  const data = await usecases.teamSummary({
    roles: req.user?.roles || [],
    userId: req.user?.id,
    viewAs: req.body?.view_as
  })
  return reply.send({ ok: true, data })
}

export async function dailyPlanHandler (req, reply) {
  const data = await getDailyPlan({
    roles: req.user?.roles || [],
    userId: req.user?.id,
    viewAs: req.body?.view_as
  })
  return reply.send({ ok: true, data })
}

// Arranca en segundo plano y responde al toque: generar tarda minutos (modelo
// local en CPU). El front consulta /daily-plan hasta que `generando` sea false.
export async function dailyPlanRegenerateHandler (req, reply) {
  const areas = regenerableAreas({ roles: req.user?.roles || [], viewAs: req.body?.view_as })
  if (!areas.length) throw new ForbiddenError('Solo el líder del área puede regenerar el plan del día')
  const data = startDailyPlanGeneration({ areas })
  return reply.code(202).send({ ok: true, data: { ...data, areas } })
}
