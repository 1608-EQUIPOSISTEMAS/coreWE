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

// A qué módulo del ERP pertenece cada tabla auditada (uso del sistema).
const TABLE_MODULE = {
  enrollments: 'FICO',
  payments: 'FICO',
  installments: 'FICO',
  leads: 'Comercial',
  lead_contact_attempts: 'Comercial',
  sales_targets: 'Comercial',
  program_editions: 'Producto',
  edition_structure: 'Producto',
  programs: 'Producto',
  program_edition_goals: 'Producto',
  edition_session_control: 'Académica',
  customers: 'Cliente',
  users: 'Configuración'
}

export async function adminSummary () {
  const raw = await repo.adminSummary()

  // Acciones por módulo del ERP, separadas en mes actual y anterior
  const porMes = {}
  for (const { mes, table_name: t, acciones } of raw.modulosPorMes) {
    const mod = TABLE_MODULE[t] ?? 'Otros'
    const bucket = (porMes[mes] ??= {})
    bucket[mod] = (bucket[mod] ?? 0) + acciones
  }
  const meses = Object.keys(porMes).sort()
  const actual = porMes[meses[meses.length - 1]] ?? {}
  const prev = (meses.length > 1 ? porMes[meses[0]] : {}) ?? {}
  const total = (b) => Object.values(b).reduce((a, x) => a + x, 0)
  const totalActual = total(actual)
  const totalPrev = total(prev)
  const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0)

  const modulos = Object.keys({ ...actual, ...prev })
    .map((m) => ({
      modulo: m,
      acciones: actual[m] ?? 0,
      accionesPrev: prev[m] ?? 0,
      pct: pct(actual[m] ?? 0, totalActual),
      deltaPts: pct(actual[m] ?? 0, totalActual) - pct(prev[m] ?? 0, totalPrev)
    }))
    .sort((a, b) => b.acciones - a.acciones)

  // El área de cada usuario top = módulo de la tabla que más toca
  const topUsuarios = raw.topUsuarios.map((u) => ({
    ...u,
    area: TABLE_MODULE[u.tabla_top] ?? 'Otros'
  }))

  return { ...raw, modulos, topUsuarios, totalAcciones: totalActual }
}

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

export async function saveProgramGoals ({ goals = [], userId }) {
  return repo.saveProgramGoals({ goals, userId })
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
