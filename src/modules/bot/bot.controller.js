import * as usecases from './bot.usecases.js'

export async function ticketListHandler (req, reply) {
  const data = await usecases.botTicketList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function ticketGetHandler (req, reply) {
  const { data } = await usecases.botTicketGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function ticketUpdateHandler (req, reply) {
  const payload = {
    ...req.body,
    current_user_id: req.user?.id || req.body.user_id
  }
  const result = await usecases.botTicketUpdate(payload)
  return reply.code(200).send({ ok: true, data: result })
}

export async function dashboardMetricsHandler (req, reply) {
  const { data } = await usecases.botDashboardMetricsGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function studentListHandler (req, reply) {
  const data = await usecases.botStudentList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function studentGetHandler (req, reply) {
  const { data } = await usecases.botStudentGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function csatListHandler (req, reply) {
  const data = await usecases.botCsatList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function advisorListHandler (req, reply) {
  const data = await usecases.botAdvisorList()
  return reply.code(200).send({ ok: true, data })
}
