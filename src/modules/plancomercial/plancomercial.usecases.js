import { planComercialRepository as repo } from './plancomercial.repository.js'
import { DomainError } from '../../shared/errors.js'
import {
  USD_TO_PEN,
  planWeeksOfMonth,
  fullWeeksTouchingMonth,
  monthStartOf,
  lastDayOfMonth,
  daysOf,
  sumInRange,
  buildMonthPlan,
  repurchaseOfMonths,
  productsOfMonth,
  buildProductGoals,
  annualReport,
  strategyReport
} from './plancomercial.entity.js'
import { buildCommercialReport, lastMonths } from './commercial-report.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

const monthsOfYear = (year) =>
  Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`)

const planByStart = (planRows) => new Map(planRows.map((p) => [p.date_start, p]))

const toGoal = (value) => (value === null || value === undefined ? null : Number(value))

function advisorLabel ({ alias, name }) {
  return { alias, nombre: name || alias }
}

// ── 2. Objetivos: el equipo, semana a semana, todo el ano ─────────────────────

// Muestra los meses que ya empezaron y los que ya tienen plan: un mes futuro sin
// objetivo no le dice nada a nadie.
export async function objetivosDelAnio ({ year, line, today = todayInLima() }) {
  const months = monthsOfYear(year)
  const from = months[0]
  const to = lastDayOfMonth(months[11])
  const [planRows, actuals] = await Promise.all([repo.planWeeks({ from, to, line }), repo.dailyActuals({ from, to, line })])
  const plan = planByStart(planRows)
  const planned = new Set(planRows.map((p) => p.month_start))

  return {
    year,
    months: months
      .filter((m) => m <= monthStartOf(today) || planned.has(m))
      .map((month) => ({
        month_start: month,
        weeks: planWeeksOfMonth(month).map((w) => {
          const p = plan.get(w.date_start) || {}
          return {
            ...w,
            obj_vacantes: toGoal(p.target_vacancies),
            obj_ingresos: toGoal(p.target_revenue),
            vacantes: sumInRange(actuals.ventas, w),
            ingresos_pen: sumInRange(actuals.ingresos, w, 'monto', (r) => !r.usd),
            ingresos_usd: sumInRange(actuals.ingresos, w, 'monto', (r) => r.usd)
          }
        })
      })),
    usd_to_pen: USD_TO_PEN
  }
}

// ── Quien aparece como asesor en los reportes ─────────────────────────────────

// Los que tienen objetivo en el periodo, mas los del equipo que vendieron o
// registraron consultas aunque nadie les haya puesto objetivo. El resto de las
// ventas (otras areas) va a "Otros" y lo de convenios a "B2B".
function advisorsOfPeriod ({ advisors, planRows, actuals }) {
  const withGoal = new Set(planRows.flatMap((p) => Object.keys(p.asesores).map(Number)))
  const active = new Set([
    ...actuals.ventas.filter((v) => !v.b2b).map((v) => v.seller_agent_id),
    ...actuals.consultas.map((c) => c.user_id)
  ])
  return advisors.filter((a) => withGoal.has(a.user_id) || active.has(a.user_id))
}

const isOther = (listed) => (v) => !v.b2b && !listed.has(v.seller_agent_id)

// ── 3. Objetivos por asesor: un mes ───────────────────────────────────────────

export async function asesoresDelMes ({ month_start: month, line }) {
  const from = month
  const to = lastDayOfMonth(month)
  const [planRows, actuals, advisors] = await Promise.all([
    repo.planWeeks({ from, to, line }), repo.dailyActuals({ from, to, line }), repo.advisors()
  ])
  const plan = planByStart(planRows)
  const listed = advisorsOfPeriod({ advisors, planRows, actuals })
  const listedIds = new Set(listed.map((a) => a.user_id))
  const weeks = planWeeksOfMonth(month)

  return {
    month_start: month,
    weeks: weeks.map((w) => ({
      ...w,
      obj_vacantes: toGoal(plan.get(w.date_start)?.target_vacancies),
      vacantes: sumInRange(actuals.ventas, w),
      otros: sumInRange(actuals.ventas, w, 'n', isOther(listedIds)),
      b2b: sumInRange(actuals.ventas, w, 'n', (v) => v.b2b)
    })),
    asesores: listed.map((a) => ({
      user_id: a.user_id,
      ...advisorLabel(a),
      semanas: weeks.map((w) => ({
        obj: toGoal(plan.get(w.date_start)?.asesores[a.user_id]),
        vacantes: sumInRange(actuals.ventas, w, 'n', (v) => !v.b2b && v.seller_agent_id === a.user_id)
      }))
    }))
  }
}

// ── 4. Ventas diarias: las semanas completas que tocan el mes ────────────────

export async function ventasDiarias ({ month_start: month, line }) {
  const weeks = fullWeeksTouchingMonth(month)
  const from = weeks[0].date_start
  const to = weeks.at(-1).date_end
  const [planRows, actuals, advisors] = await Promise.all([
    repo.planWeeks({ from, to, line }), repo.dailyActuals({ from, to, line }), repo.advisors()
  ])
  const listed = advisorsOfPeriod({ advisors, planRows, actuals })

  // Una semana completa puede juntar dos tramos del plan (31/08 + 1-6/09): su
  // objetivo es la suma de ambos. Sin ningun tramo cargado, queda sin objetivo.
  const goalOfWeek = (week, userId) => {
    const segments = planRows.filter((p) => p.date_start >= week.date_start && p.date_end <= week.date_end)
    const values = segments.map((p) => p.asesores[userId]).filter((v) => v !== null && v !== undefined)
    return values.length ? values.reduce((s, v) => s + Number(v), 0) : null
  }
  const perDay = (week, rows, matches) => daysOf(week).map((dia) => sumInRange(rows, { date_start: dia, date_end: dia }, 'n', matches))

  return {
    month_start: month,
    weeks: weeks.map((w) => ({
      ...w,
      dias: daysOf(w),
      asesores: listed.map((a) => ({
        user_id: a.user_id,
        ...advisorLabel(a),
        obj: goalOfWeek(w, a.user_id),
        consultas: perDay(w, actuals.consultas, (c) => c.user_id === a.user_id),
        ventas: perDay(w, actuals.ventas, (v) => !v.b2b && v.seller_agent_id === a.user_id)
      })),
      // B2B se muestra para contexto pero no es venta del equipo: no suma al VEN.
      // Las ventas de otras areas ("Otros") no entran en este reporte.
      b2b: perDay(w, actuals.ventas, (v) => v.b2b)
    }))
  }
}

// ── Re-compra: los meses del año que ya empezaron ─────────────────────────────

export async function recompraDelAnio ({ year, today = todayInLima() }) {
  const months = monthsOfYear(year).filter((m) => m <= monthStartOf(today))
  if (!months.length) return { year, months: [] }
  const rows = await repo.repurchaseSales({ from: months[0], to: lastDayOfMonth(months.at(-1)) })
  return { year, months: repurchaseOfMonths(rows, months) }
}

// ── Productos online: un mes ─────────────────────────────────────────────────

export async function productosDelMes ({ month_start: month }) {
  const to = lastDayOfMonth(month)
  const [sales, goals] = await Promise.all([repo.productSales({ from: month, to }), repo.productGoals({ from: month, to })])
  return { month_start: month, productos: productsOfMonth(sales, goals) }
}

// ── Anual: curva entre años y ventas por asesor ──────────────────────────────

// La historia del ERP empieza en sep-2025 (importacion masiva): pedir desde 2024
// no cuesta nada y deja la curva lista si algun dia se carga ese año.
const HISTORY_FROM = '2024-01-01'

export async function anualComercial ({ year }) {
  const rows = await repo.salesByMonthAndSeller({ from: HISTORY_FROM, to: `${year}-12-31` })
  return annualReport(rows, year)
}

// ── Estrategias: un mes ──────────────────────────────────────────────────────

export async function estrategiasDelMes ({ month_start: month }) {
  const rows = await repo.strategyLeads({ from: month, to: lastDayOfMonth(month) })
  return { month_start: month, ...strategyReport(rows) }
}

// ── Carga de objetivos ───────────────────────────────────────────────────────

export async function planDelMes ({ month_start: month, line }) {
  const to = lastDayOfMonth(month)
  const [planRows, advisors, goals] = await Promise.all([
    repo.planWeeks({ from: month, to, line }), repo.advisors(),
    line === 'ONLINE' ? repo.productGoals({ from: month, to }) : []
  ])
  const plan = planByStart(planRows)
  return {
    month_start: month,
    line,
    productos: line === 'ONLINE'
      ? Object.fromEntries(goals.map((g) => [g.product, g.target_vacancies]))
      : null,
    asesores: advisors.map((a) => ({ user_id: a.user_id, ...advisorLabel(a) })),
    weeks: planWeeksOfMonth(month).map((w) => {
      const p = plan.get(w.date_start) || {}
      return {
        ...w,
        obj_vacantes: toGoal(p.target_vacancies),
        obj_ingresos: toGoal(p.target_revenue),
        asesores: p.asesores || {}
      }
    })
  }
}

export async function guardarPlanDelMes ({ month_start: month, line, weeks: input, productos: productInput, userId }) {
  let plan
  let productos = null
  try {
    plan = buildMonthPlan(month, input)
    if (line === 'ONLINE') productos = buildProductGoals(productInput)
  } catch (err) {
    if (err instanceof RangeError) throw new DomainError(err.message)
    throw err
  }
  if (plan.unknown.length) {
    throw new DomainError(`Estas semanas no son del mes ${month}: ${plan.unknown.join(', ')}`)
  }
  return repo.saveMonth({ monthStart: month, line, weeks: plan.weeks, productos, userId })
}

// ── Informe Comercial: objetivos del area, un mes contra los 5 anteriores ─────

const BLACK_EXPIRING_DAYS = 60

export async function reporteComercial ({ date_start: start, date_end: end, today = todayInLima() }) {
  if (start > end) throw new DomainError('La fecha de inicio no puede ser posterior a la de fin')
  const meses = lastMonths(end.slice(0, 7))
  // Los 6 meses de la serie y el rango elegido, que puede empezar antes.
  const from = [`${meses[0]}-01`, start].sort()[0]
  const to = [lastDayOfMonth(`${meses.at(-1)}-01`), end].sort().at(-1)
  const [ventas, fuera, conversion, planWeeks, cohortes, ediciones, blackPorVencer] = await Promise.all([
    repo.reportSales({ from, to }),
    repo.reportSalesOutside({ from, to }),
    repo.reportConversion({ from, to }),
    repo.reportSalesGoals({ from, to }),
    repo.reportRepurchaseCohorts({ from: `${meses[0]}-01`, to }),
    repo.reportLeadPlan({ from: start, to: end }),
    repo.reportBlackExpiring({ days: BLACK_EXPIRING_DAYS })
  ])
  return buildCommercialReport({ period: { start, end }, today, ventas: [...ventas, ...fuera], conversion, planWeeks, cohortes, ediciones, blackPorVencer })
}
