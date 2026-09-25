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
  buildMonthPlan
} from './plancomercial.entity.js'

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
export async function objetivosDelAnio ({ year, today = todayInLima() }) {
  const months = monthsOfYear(year)
  const from = months[0]
  const to = lastDayOfMonth(months[11])
  const [planRows, actuals] = await Promise.all([repo.planWeeks({ from, to }), repo.dailyActuals({ from, to })])
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

export async function asesoresDelMes ({ month_start: month }) {
  const from = month
  const to = lastDayOfMonth(month)
  const [planRows, actuals, advisors] = await Promise.all([
    repo.planWeeks({ from, to }), repo.dailyActuals({ from, to }), repo.advisors()
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

export async function ventasDiarias ({ month_start: month }) {
  const weeks = fullWeeksTouchingMonth(month)
  const from = weeks[0].date_start
  const to = weeks.at(-1).date_end
  const [planRows, actuals, advisors] = await Promise.all([
    repo.planWeeks({ from, to }), repo.dailyActuals({ from, to }), repo.advisors()
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

// ── Carga de objetivos ───────────────────────────────────────────────────────

export async function planDelMes ({ month_start: month }) {
  const [planRows, advisors] = await Promise.all([
    repo.planWeeks({ from: month, to: lastDayOfMonth(month) }), repo.advisors()
  ])
  const plan = planByStart(planRows)
  return {
    month_start: month,
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

export async function guardarPlanDelMes ({ month_start: month, weeks: input, userId }) {
  let plan
  try {
    plan = buildMonthPlan(month, input)
  } catch (err) {
    if (err instanceof RangeError) throw new DomainError(err.message)
    throw err
  }
  if (plan.unknown.length) {
    throw new DomainError(`Estas semanas no son del mes ${month}: ${plan.unknown.join(', ')}`)
  }
  return repo.saveMonth({ weeks: plan.weeks, userId })
}
