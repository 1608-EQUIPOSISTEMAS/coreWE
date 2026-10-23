// Producto > Ventas: que programas se venden mas en En Vivo, Online y Membresias.
// Reglas puras sobre las filas de profitabilityRepository.salesSold: la venta
// es la misma que cuenta FICO, aqui solo se reagrupa para quien arma el catalogo.

const MEMBERSHIP = 'Membresía'

// B2B y Fundacion quedan fuera: esa venta la cierra el convenio, no el catalogo.
// La membresia va aparte aunque su programa sea Online: compite con otra cosa.
export const SECTIONS = [
  { key: 'ENVIVO', label: 'En Vivo', matches: r => r.linea === 'ENVIVO' && r.tipo !== MEMBERSHIP },
  { key: 'ONLINE', label: 'Online', matches: r => r.linea === 'ONLINE' && r.tipo !== MEMBERSHIP },
  { key: 'MEMBRESIA', label: 'Membresías', matches: r => ['ENVIVO', 'ONLINE'].includes(r.linea) && r.tipo === MEMBERSHIP }
]

const round = n => Math.round(n * 100) / 100
const variation = (now, before) => (before ? round(((now - before) / before) * 100) : null)
const toneOfTrend = v => (v === null ? null : v >= 0 ? 'ok' : 'bad')

// "Se vende mas" = mas ventas; a igual cantidad, la que trae mas soles.
const bySales = (a, b) => b.n - a.n || b.soles - a.soles

function sumByProgram (rows) {
  const programs = new Map()
  for (const r of rows) {
    if (!programs.has(r.program_id)) programs.set(r.program_id, { program_id: r.program_id, programa: r.programa, tipo: r.tipo, n: 0, soles: 0 })
    const p = programs.get(r.program_id)
    p.n += Number(r.n)
    p.soles += Number(r.soles)
  }
  return [...programs.values()].sort(bySales)
}

function sumByType (programs, total) {
  const types = new Map()
  for (const p of programs) {
    if (!types.has(p.tipo)) types.set(p.tipo, { tipo: p.tipo, n: 0, soles: 0 })
    const t = types.get(p.tipo)
    t.n += p.n
    t.soles += p.soles
  }
  return [...types.values()].sort(bySales).map(t => ({ ...t, soles: round(t.soles), pct: total ? round((t.n / total) * 100) : null }))
}

// Una caida se mide contra un piso: de 2 ventas a 1 es la mitad, pero es ruido.
export const DROP_MIN_PREV = 3
export const DROP_RATIO = 0.5

// Vendia y ahora vende la mitad o menos (incluye a los que llegaron a cero):
// la mayor perdida en ventas va primero.
function droppedPrograms (programs, prevPrograms) {
  const nowById = new Map(programs.map(p => [p.program_id, p.n]))
  return prevPrograms
    .filter(p => p.n >= DROP_MIN_PREV && (nowById.get(p.program_id) || 0) <= p.n * DROP_RATIO)
    .map(p => {
      const n = nowById.get(p.program_id) || 0
      return { program_id: p.program_id, programa: p.programa, tipo: p.tipo, n, n_prev: p.n, variacion: variation(n, p.n) }
    })
    .sort((a, b) => (b.n_prev - b.n) - (a.n_prev - a.n))
}

// El puesto anterior dice si un programa sube o baja en el ranking, que es lo
// que Producto mira para decidir que reprogramar o empujar.
function buildSection (section, rows, prevRows) {
  const programs = sumByProgram(rows.filter(section.matches))
  const prevPrograms = sumByProgram(prevRows.filter(section.matches))
  const prevById = new Map(prevPrograms.map((p, i) => [p.program_id, { ...p, puesto: i + 1 }]))
  const n = programs.reduce((s, p) => s + p.n, 0)
  const soles = round(programs.reduce((s, p) => s + p.soles, 0))
  const nPrev = prevPrograms.reduce((s, p) => s + p.n, 0)
  return {
    key: section.key,
    label: section.label,
    n,
    n_prev: nPrev,
    n_trend: variation(n, nPrev),
    n_tone: toneOfTrend(variation(n, nPrev)),
    soles,
    tipos: sumByType(programs, n),
    programas: programs.map((p, i) => {
      const prev = prevById.get(p.program_id)
      return {
        ...p,
        soles: round(p.soles),
        puesto: i + 1,
        puesto_prev: prev?.puesto ?? null,
        n_prev: prev?.n ?? 0,
        pct: n ? round((p.n / n) * 100) : null
      }
    }),
    caidas: droppedPrograms(programs, prevPrograms)
  }
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const pad = n => String(n).padStart(2, '0')

// Aritmetica de calendario en UTC sobre 'YYYY-MM-DD' (en Lima los getters
// locales corren la fecha un dia).
const shiftDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const mondayOf = ymd => shiftDays(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7))
const nextMonth = ym => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}
function range (first, last, next) {
  const out = []
  for (let s = first; s <= last; s = next(s)) out.push(s)
  return out
}

// Como se parte cada periodo: los casilleros (solo hasta `to`: en un periodo en
// curso lo que falta saldria en cero y pareceria una caida), a cual cae una
// venta y su rotulo. La semana arranca el lunes; la primera se rotula con el
// inicio del periodo para no mostrar un dia de afuera.
const BUCKETS = {
  dia: {
    slots: p => range(p.from, p.to, s => shiftDays(s, 1)),
    slotOf: dia => dia,
    label: s => String(Number(s.slice(8, 10)))
  },
  semana: {
    slots: p => range(mondayOf(p.from), p.to, s => shiftDays(s, 7)),
    slotOf: dia => mondayOf(dia),
    label: (s, p) => { const d = s < p.from ? p.from : s; return `${d.slice(8, 10)}/${d.slice(5, 7)}` }
  },
  mes: {
    slots: p => range(p.from.slice(0, 7), p.to.slice(0, 7), nextMonth),
    slotOf: dia => dia.slice(0, 7),
    label: s => MONTHS[Number(s.slice(5, 7)) - 1]
  }
}

// Ventas por casillero de cada seccion, en la misma escala. Un dia no tiene serie.
function buildSeries (period, rows) {
  const bucket = BUCKETS[period.bucket]
  if (!bucket) return null
  const slots = bucket.slots(period)
  const slotOf = r => bucket.slotOf(r.dia)
  return {
    categorias: slots.map(s => bucket.label(s, period)),
    secciones: SECTIONS.map(section => {
      const counts = new Map(slots.map(s => [s, 0]))
      for (const r of rows.filter(section.matches)) counts.set(slotOf(r), (counts.get(slotOf(r)) || 0) + Number(r.n))
      return { key: section.key, label: section.label, datos: slots.map(s => counts.get(s)) }
    })
  }
}

// `rows`/`prevRows` = { dia, linea, tipo, program_id, programa, n, soles }.
export function buildProductSales ({ period, rows, prevRows }) {
  return { period, secciones: SECTIONS.map(s => buildSection(s, rows, prevRows)), serie: buildSeries(period, rows) }
}
