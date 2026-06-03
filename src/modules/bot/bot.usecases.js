import { botRepository } from './bot.repository.js'
import { buildDashboardFilters, buildTicketUpdatePayload } from './bot.entity.js'
import { toPaginatedDto, toSingleDto, toTicketUpdateDto, toItemsDto } from './bot.dto.js'

const repo = botRepository

export async function botTicketList (payload = {}) {
  const { page = 1, size = 25 } = payload
  const rows = await repo.ticketList(payload)
  return toPaginatedDto({ rows, page, size })
}

export async function botTicketGet ({ id }) {
  const rows = await repo.ticketGet(id)
  return toSingleDto({ rows })
}

export async function botTicketUpdate (payload = {}) {
  const { id } = payload
  await repo.ticketUpdate(id, buildTicketUpdatePayload(payload))
  return toTicketUpdateDto({ id })
}

export async function botDashboardMetricsGet (payload = {}) {
  const rows = await repo.dashboardMetricsGet(buildDashboardFilters(payload))
  return toSingleDto({ rows })
}

export async function botStudentList (payload = {}) {
  const { page = 1, size = 25 } = payload
  const rows = await repo.studentList(payload)
  return toPaginatedDto({ rows, page, size })
}

export async function botStudentGet ({ id }) {
  const rows = await repo.studentGet(id)
  return toSingleDto({ rows })
}

export async function botCsatList (payload = {}) {
  const { page = 1, size = 25 } = payload
  const rows = await repo.csatList(payload)
  return toPaginatedDto({ rows, page, size })
}

export async function botAdvisorList () {
  const rows = await repo.advisorList()
  return toItemsDto({ rows })
}
