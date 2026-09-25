// Reglas puras del Plan Comercial: el calendario de semanas y la suma de logros.
// Sin BD ni HTTP.
//
// Las fechas viajan como texto 'YYYY-MM-DD' y toda la aritmetica se hace en UTC:
// mezclar Date.UTC con getters locales corre la fecha un dia en Lima (UTC-5).

const DAY_MS = 86_400_000

// Mismo tipo fijo que v_dashboard_* y los paneles de resultados: los reportes
// del ERP no guardan el tipo de cambio del dia.
export const USD_TO_PEN = 3.75

const toUtc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const toYmd = (ms) => new Date(ms).toISOString().slice(0, 10)

export const addDays = (ymd, days) => toYmd(toUtc(ymd) + days * DAY_MS)

// 0 = lunes ... 6 = domingo.
const isoWeekday = (ymd) => (new Date(toUtc(ymd)).getUTCDay() + 6) % 7

export const mondayOf = (ymd) => addDays(ymd, -isoWeekday(ymd))

// La semana ISO la define su jueves: la semana 1 es la que contiene el 4 de enero.
export function isoWeekNumber (ymd) {
  const thursday = addDays(mondayOf(ymd), 3)
  const jan1 = `${thursday.slice(0, 4)}-01-01`
  return 1 + Math.floor((toUtc(thursday) - toUtc(jan1)) / DAY_MS / 7)
}

export const isMonthStart = (ymd) => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(String(ymd))
export const monthStartOf = (ymd) => `${ymd.slice(0, 7)}-01`

export function nextMonthStart (monthStart) {
  const [y, m] = monthStart.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export const lastDayOfMonth = (monthStart) => addDays(nextMonthStart(monthStart), -1)

// Las semanas en que se planifica un mes: semanas ISO recortadas al mes. Una
// semana que cruza el cambio de mes aparece en los dos, cada lado con su propio
// objetivo (S36 = 31 de agosto y S36 = 1 al 6 de septiembre).
export function planWeeksOfMonth (monthStart) {
  const last = lastDayOfMonth(monthStart)
  const weeks = []
  for (let start = monthStart; start <= last;) {
    const sunday = addDays(mondayOf(start), 6)
    const end = sunday < last ? sunday : last
    weeks.push({ week_label: `S${isoWeekNumber(start)}`, date_start: start, date_end: end })
    start = addDays(end, 1)
  }
  return weeks
}

// Las semanas completas, de lunes a domingo, que tocan el mes. Es el corte del
// reporte diario: ahi se leen los siete dias aunque alguno sea del mes vecino.
export function fullWeeksTouchingMonth (monthStart) {
  const last = lastDayOfMonth(monthStart)
  const weeks = []
  for (let monday = mondayOf(monthStart); monday <= last; monday = addDays(monday, 7)) {
    weeks.push({ week_label: `S${isoWeekNumber(monday)}`, date_start: monday, date_end: addDays(monday, 6) })
  }
  return weeks
}

export const daysOf = ({ date_start, date_end }) => {
  const days = []
  for (let d = date_start; d <= date_end; d = addDays(d, 1)) days.push(d)
  return days
}

// Suma `field` de las filas cuyo `dia` cae en el rango, con un filtro opcional.
export function sumInRange (rows, { date_start, date_end }, field = 'n', matches = () => true) {
  let total = 0
  for (const r of rows) {
    if (r.dia >= date_start && r.dia <= date_end && matches(r)) total += Number(r[field] || 0)
  }
  return total
}

// Un objetivo vacio NO es cero: sin cargar, la pantalla muestra "—" en vez de
// dar por cumplido o incumplido un objetivo que nadie puso.
const toGoal = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Objetivo invalido: ${value}`)
  return n
}

// Arma lo que se guarda de un mes a partir de lo que manda la pantalla. Las
// fechas y etiquetas se recalculan aca y NO se toman del payload: son la llave de
// la tabla y un rango inventado partiria el mes en semanas que no existen.
// Devuelve tambien las fechas que no son semanas de ese mes, para rechazarlas.
export function buildMonthPlan (monthStart, weeksInput = []) {
  const byStart = new Map(weeksInput.map((w) => [w.date_start, w]))
  const calendar = planWeeksOfMonth(monthStart)
  const unknown = weeksInput
    .map((w) => w.date_start)
    .filter((start) => !calendar.some((c) => c.date_start === start))

  const weeks = calendar.map((c) => {
    const input = byStart.get(c.date_start) || {}
    const asesores = Object.entries(input.asesores || {})
      .map(([userId, goal]) => ({ seller_agent_id: Number(userId), target_vacancies: toGoal(goal) }))
      .filter((a) => Number.isInteger(a.seller_agent_id) && a.target_vacancies !== null)
    return {
      ...c,
      month_start: monthStart,
      target_vacancies: toGoal(input.obj_vacantes),
      target_revenue: toGoal(input.obj_ingresos),
      asesores
    }
  })
  return { weeks, unknown }
}
