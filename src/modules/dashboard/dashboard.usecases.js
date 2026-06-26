import { dashboardRepository } from './dashboard.repository.js'
import { aggregateVentasCanal } from './dashboard.entity.js'
import {
  toDashboardDto,
  toProgramGoalsDto,
  toLiderDto,
  toContactabilityDto,
  toAvailableWeeksDto,
  toDetailLeadsDto,
  toDetailSalesDto
} from './dashboard.dto.js'

const repo = dashboardRepository

export async function dashboardList (payload = {}) {
  const {
    year = 2026,
    modality = 'NO_ONLINE',
    date_start = null,
    date_end = null,
    month = null,
    period = null
  } = payload

  const rows = await repo.dashboardComercial({ year, modality, date_start, date_end, month, period })
  return toDashboardDto(rows)
}

export async function programGoalsList (payload = {}) {
  const { year = 2026, month_num = 1 } = payload
  const rows = await repo.programGoals({ year, month_num })
  return toProgramGoalsDto(rows)
}

export async function leadsPerEdition (payload = {}) {
  const { edition_ids = [] } = payload
  return repo.leadsPerEdition({ edition_ids })
}

export async function dashboardTargetRegister ({ target = {} } = {}) {
  return repo.registerTarget(target)
}

export async function liderList (payload = {}) {
  const { year = 2026, month = 1, advisor = 'all' } = payload
  const rows = await repo.lider({ year, month, advisor })
  return toLiderDto(rows)
}

export async function contactabilityList (payload = {}) {
  const { year = 2026, month = 1, advisor = 'all' } = payload
  const rows = await repo.contactability({ year, month, advisor })
  return toContactabilityDto(rows)
}

export async function ventasCanalList (payload = {}) {
  const { year = 2026, month_num = 1, advisor = 'all' } = payload
  const rows = await repo.ventasCanal({ year, month_num, advisor })
  return aggregateVentasCanal(rows)
}

export async function availableWeeks (payload = {}) {
  const { year = 2026, modality = 'NO_ONLINE' } = payload
  const rows = await repo.availableWeeks({ year, modality })
  return toAvailableWeeksDto(rows)
}

export async function detailLeads (payload = {}) {
  const { cod_asesor, date, page = 1, size = 100 } = payload
  const offset = (page - 1) * size
  const rows = await repo.detailLeads({ cod_asesor, date, size, offset })
  return { data: toDetailLeadsDto(rows), page, size }
}

export async function detailSales (payload = {}) {
  const { cod_asesor, date, page = 1, size = 100 } = payload
  const offset = (page - 1) * size
  const rows = await repo.detailSales({ cod_asesor, date, size, offset })
  return { data: toDetailSalesDto(rows), page, size }
}
