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

// Re-compra del Sheet "3. Reporte de Re-Compra": por mes y por semana recortada
// al mes, ventas totales (VEN T) y las de clientes que ya habian comprado (VEN CWE).
// `rows` = [{ dia, ventas, cwe }]; el % lo calcula la vista.
export function repurchaseOfMonths (rows, months) {
  const total = (range) => ({ ventas: sumInRange(rows, range, 'ventas'), cwe: sumInRange(rows, range, 'cwe') })
  return months.map((month) => ({
    month_start: month,
    ...total({ date_start: month, date_end: lastDayOfMonth(month) }),
    weeks: planWeeksOfMonth(month).map((w) => ({ ...w, ...total(w) }))
  }))
}

// Productos de la linea Online, en el orden del Sheet "1. Plan Comercial Online".
export const ONLINE_PRODUCTS = ['PLUS', 'CURSOS', 'ESPECIALIZACIONES', 'GOLD_PLAT', 'BLACK']
const SALE_CHANNELS = ['MKT', 'COM', 'WEB', 'OTROS']
const CLIENT_TYPES = ['NEW', 'LDS', 'CWE']

// Logro del mes por producto contra su objetivo, abierto por canal y por tipo de
// cliente. Una venta sin lead no dice su tipo: cae en SIN_DATO, no en NEW.
// `sales` = [{ product, canal, tipo, n }] del mes; `goals` = [{ product, target_vacancies }].
export function productsOfMonth (sales, goals) {
  const goalOf = new Map(goals.map((g) => [g.product, Number(g.target_vacancies)]))
  const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]))
  return ONLINE_PRODUCTS.map((product) => {
    const row = { product, obj: goalOf.get(product) ?? null, ventas: 0, canal: zeros(SALE_CHANNELS), tipo: zeros([...CLIENT_TYPES, 'SIN_DATO']) }
    for (const s of sales.filter((x) => x.product === product)) {
      row.ventas += s.n
      row.canal[SALE_CHANNELS.includes(s.canal) ? s.canal : 'OTROS'] += s.n
      row.tipo[CLIENT_TYPES.includes(s.tipo) ? s.tipo : 'SIN_DATO'] += s.n
    }
    return row
  })
}

// Objetivos por producto que manda la pantalla: { PLUS: 12, CURSOS: '', ... }.
// Vacio = sin objetivo (no se guarda fila); un producto desconocido se rechaza.
export function buildProductGoals (input = {}) {
  const unknown = Object.keys(input).filter((p) => !ONLINE_PRODUCTS.includes(p))
  if (unknown.length) throw new RangeError(`Productos desconocidos: ${unknown.join(', ')}`)
  return ONLINE_PRODUCTS
    .map((product) => ({ product, target_vacancies: toGoal(input[product]) }))
    .filter((p) => p.target_vacancies !== null)
}

// ── Reporte Anual: curva por año y ventas por asesor ─────────────────────────

const twelveZeros = () => Array.from({ length: 12 }, () => 0)

// `rows` = [{ mes: 'YYYY-MM', seller_id, alias, name, n }] de varios años.
// curva = un arreglo de 12 meses por año con datos; asesores = los que vendieron
// en `year`, de mayor a menor, con su participacion sobre el total del año (una
// venta sin asesor va a "Sin asesor", asi el total es el total real).
export function annualReport (rows, year) {
  const curvas = new Map()
  const asesores = new Map()
  const total = twelveZeros()
  for (const r of rows) {
    const [y, m] = r.mes.split('-').map(Number)
    if (!curvas.has(y)) curvas.set(y, twelveZeros())
    curvas.get(y)[m - 1] += r.n
    if (y !== year) continue
    total[m - 1] += r.n
    const key = r.seller_id ?? 'sin'
    if (!asesores.has(key)) {
      asesores.set(key, { id: r.seller_id ?? null, alias: r.alias ?? null, nombre: r.name || r.alias || 'Sin asesor', meses: twelveZeros() })
    }
    asesores.get(key).meses[m - 1] += r.n
  }
  const totalAnio = total.reduce((s, x) => s + x, 0)
  return {
    year,
    curva: [...curvas].sort(([a], [b]) => a - b).map(([y, meses]) => ({ year: y, meses, total: meses.reduce((s, x) => s + x, 0) })),
    total,
    asesores: [...asesores.values()]
      .map((a) => {
        const suma = a.meses.reduce((s, x) => s + x, 0)
        return { ...a, total: suma, participacion: totalAnio ? suma / totalAnio : null }
      })
      .sort((a, b) => b.total - a.total)
  }
}

// ── Reporte de Estrategias ───────────────────────────────────────────────────

// `rows` = [{ estrategia, programa, consultas, ventas }] de un mes. Devuelve las
// estrategias (de mas a menos consultas) con su conversion = ventas / consultas
// del mes (flujo, no cohorte: igual que Ventas por canal) y sus programas.
export function strategyReport (rows) {
  const porEstrategia = new Map()
  for (const r of rows) {
    if (!porEstrategia.has(r.estrategia)) porEstrategia.set(r.estrategia, { estrategia: r.estrategia, consultas: 0, ventas: 0, programas: [] })
    const e = porEstrategia.get(r.estrategia)
    e.consultas += r.consultas
    e.ventas += r.ventas
    e.programas.push({ programa: r.programa, consultas: r.consultas, ventas: r.ventas })
  }
  const conv = (x) => (x.consultas ? x.ventas / x.consultas : null)
  const estrategias = [...porEstrategia.values()]
    .map((e) => ({ ...e, conversion: conv(e), programas: e.programas.sort((a, b) => b.consultas - a.consultas || b.ventas - a.ventas) }))
    .sort((a, b) => b.consultas - a.consultas || b.ventas - a.ventas)
  const total = estrategias.reduce((s, e) => ({ consultas: s.consultas + e.consultas, ventas: s.ventas + e.ventas }), { consultas: 0, ventas: 0 })
  return { estrategias, total: { ...total, conversion: conv(total) } }
}
