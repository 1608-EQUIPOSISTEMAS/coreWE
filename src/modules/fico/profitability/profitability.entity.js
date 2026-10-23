import { DomainError } from '../../../shared/errors.js'

// Ventas por Linea -> Tipo de programa -> Programa, y rentabilidad por programa.
// Reglas puras: el repository trae filas planas y aqui se arman el periodo, los
// arboles, el reparto de costos y los tonos.

// Unidades de negocio, en el orden y con los nombres de contabilidad (FC-EGRESOS).
export const LINES = [
  { key: 'ENVIVO', label: 'En Vivo' },
  { key: 'ONLINE', label: 'Online' },
  { key: 'B2B', label: 'B2B' },
  { key: 'FUNDACION', label: 'Fundación' }
]
const LINE_KEYS = LINES.map(l => l.key)

const pad = n => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
// Aritmetica de calendario en UTC: con getters locales en Lima la fecha se
// corre un dia (ver memoria fechas-utc-en-lima).
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const shiftDay = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const monthOf = (y, m) => {
  const d = new Date(Date.UTC(y, m - 1, 1))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// El periodo pedido y el anterior del mismo largo (ayer, mes pasado, año pasado).
// `bucket` es como se parte la serie: un dia no tiene serie.
export function periodRange (granularity, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new DomainError('Fecha invalida')
  const [y, m] = date.split('-').map(Number)
  if (granularity === 'dia') {
    const prev = shiftDay(date, -1)
    return { granularity, from: date, to: date, prev: { from: prev, to: prev }, bucket: null }
  }
  if (granularity === 'mes') {
    const p = monthOf(y, m - 1)
    return {
      granularity,
      from: iso(y, m, 1),
      to: iso(y, m, daysInMonth(y, m)),
      prev: { from: iso(p.y, p.m, 1), to: iso(p.y, p.m, daysInMonth(p.y, p.m)) },
      bucket: 'dia'
    }
  }
  // Trimestre calendario (ene-mar, abr-jun…) contra el anterior. Lo usa Producto >
  // Ventas (FICO no lo expone): su serie va por semana, 3 meses son pocos puntos.
  if (granularity === 'trimestre') {
    const q = Math.floor((m - 1) / 3) * 3 + 1
    const end = monthOf(y, q + 2)
    const p = monthOf(y, q - 3)
    const pEnd = monthOf(y, q - 1)
    return {
      granularity,
      from: iso(y, q, 1),
      to: iso(end.y, end.m, daysInMonth(end.y, end.m)),
      prev: { from: iso(p.y, p.m, 1), to: iso(pEnd.y, pEnd.m, daysInMonth(pEnd.y, pEnd.m)) },
      bucket: 'semana'
    }
  }
  if (granularity === 'anio') {
    return { granularity, from: iso(y, 1, 1), to: iso(y, 12, 31), prev: { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) }, bucket: 'mes' }
  }
  throw new DomainError('Periodo invalido: dia, mes, trimestre o anio')
}

// Periodo en curso: se corta a hoy y el anterior a los mismos dias (1-19 oct
// contra 1-19 sep, ene-19 oct contra lo mismo del año pasado). Comparar medio
// mes contra uno completo siempre "cae" y no dice nada.
export function salesRange (granularity, date, today) {
  const period = periodRange(granularity, date)
  if (!(period.from <= today && today < period.to)) return { ...period, partial: false }
  const elapsed = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000)
  const prevTo = [shiftDay(period.prev.from, elapsed), period.prev.to].sort()[0]
  return { ...period, to: today, prev: { from: period.prev.from, to: prevTo }, partial: true }
}

// La rentabilidad no se mide por dia (un costo docente no se reparte por dias):
// un dia se lee como su mes.
export function profitRange (granularity, date) {
  return periodRange(granularity === 'dia' ? 'mes' : granularity, date)
}

// Horas por sesion desde el alias del horario: we_hour_combination_19_22 = 3 h,
// _1930_2200 = 2.5 h. Sin horario (o uno que no se lee) => null, nunca un supuesto.
export function hoursPerSession (alias) {
  const match = /_(\d{2})(\d{2})?_(\d{2})(\d{2})?$/.exec(alias || '')
  if (!match) return null
  const [, h1, m1 = '00', h2, m2 = '00'] = match
  const hours = (Number(h2) * 60 + Number(m2) - Number(h1) * 60 - Number(m1)) / 60
  return hours > 0 ? hours : null
}

const round = n => Math.round(n * 100) / 100
const pct = (part, whole) => (whole ? round((part / whole) * 100) : null)
const variation = (now, before) => (before ? round(((now - before) / before) * 100) : null)
const toneOfTrend = v => (v === null ? null : v >= 0 ? 'ok' : 'bad')

// Arbol Linea -> Tipo -> Programa sumando `fields` de cada fila. Cada nodo trae
// sus hijos ordenados por el primer campo (el que manda: soles o margen).
function buildTree (rows, fields, keyOf = r => r.program_id) {
  const empty = () => Object.fromEntries(fields.map(f => [f, 0]))
  const add = (node, row) => { for (const f of fields) node[f] = round(node[f] + (Number(row[f]) || 0)) }
  const lines = new Map()
  for (const row of rows) {
    if (!lines.has(row.linea)) lines.set(row.linea, { key: row.linea, ...empty(), tipos: new Map() })
    const line = lines.get(row.linea)
    const tipoKey = row.tipo || 'Sin tipo'
    if (!line.tipos.has(tipoKey)) line.tipos.set(tipoKey, { key: `${row.linea}|${tipoKey}`, label: tipoKey, ...empty(), programas: new Map() })
    const tipo = line.tipos.get(tipoKey)
    const progKey = keyOf(row)
    if (!tipo.programas.has(progKey)) tipo.programas.set(progKey, { key: `${row.linea}|${progKey}`, program_id: row.program_id, label: row.programa, ...empty() })
    add(line, row); add(tipo, row); add(tipo.programas.get(progKey), row)
  }
  const byMain = (a, b) => b[fields[0]] - a[fields[0]]
  return LINES
    .filter(l => lines.has(l.key))
    .map(l => {
      const line = lines.get(l.key)
      return {
        ...line,
        label: l.label,
        tipos: [...line.tipos.values()].sort(byMain).map(t => ({ ...t, programas: [...t.programas.values()].sort(byMain) }))
      }
    })
}

const sumBy = (rows, f) => round(rows.reduce((s, r) => s + (Number(r[f]) || 0), 0))

// Cada nodo del arbol se compara contra el mismo nodo del periodo anterior.
function attachPrevious (tree, prevRows, total) {
  const prevBy = key => sumBy(prevRows.filter(key), 'soles')
  for (const line of tree) {
    line.pct = pct(line.soles, total)
    line.prev = prevBy(r => r.linea === line.key)
    line.trend = variation(line.soles, line.prev)
    for (const tipo of line.tipos) {
      tipo.pct = pct(tipo.soles, total)
      tipo.prev = prevBy(r => r.linea === line.key && (r.tipo || 'Sin tipo') === tipo.label)
      tipo.trend = variation(tipo.soles, tipo.prev)
      for (const p of tipo.programas) {
        p.pct = pct(p.soles, total)
        p.prev = prevBy(r => r.linea === line.key && r.program_id === p.program_id)
        p.trend = variation(p.soles, p.prev)
      }
    }
  }
  return tree
}

// Serie del periodo: dias del mes o meses del año, con ceros donde no hubo.
function buildSeries (period, rows) {
  if (!period.bucket) return null
  const slots = period.bucket === 'dia'
    ? Array.from({ length: Number(period.to.slice(8, 10)) }, (_, i) => period.from.slice(0, 8) + pad(i + 1))
    : Array.from({ length: 12 }, (_, i) => `${period.from.slice(0, 4)}-${pad(i + 1)}`)
  const keyOf = r => (period.bucket === 'dia' ? r.dia : r.dia.slice(0, 7))
  const totals = new Map(slots.map(s => [s, 0]))
  for (const r of rows) totals.set(keyOf(r), round((totals.get(keyOf(r)) || 0) + Number(r.soles)))
  return {
    categorias: slots.map(s => (period.bucket === 'dia' ? String(Number(s.slice(8, 10))) : MONTHS[Number(s.slice(5, 7)) - 1])),
    series: [{ nombre: 'Soles', tono: 'accent', datos: slots.map(s => totals.get(s)) }]
  }
}

// Pestaña Ventas. `rows`/`prevRows` = { dia, linea, tipo, program_id, programa, n, soles }.
export function buildSalesView ({ period, measure, rows, prevRows }) {
  const total = sumBy(rows, 'soles')
  const prevTotal = sumBy(prevRows, 'soles')
  const count = sumBy(rows, 'n')
  const prevCount = sumBy(prevRows, 'n')
  const ticket = count ? round(total / count) : null
  const prevTicket = prevCount ? round(prevTotal / prevCount) : null
  const lineas = attachPrevious(buildTree(rows, ['soles', 'n']), prevRows, total)
  const top = lineas[0]
  return {
    period,
    measure,
    kpis: {
      soles: total, soles_prev: prevTotal, soles_trend: variation(total, prevTotal), soles_tone: toneOfTrend(variation(total, prevTotal)),
      n: count, n_prev: prevCount, n_trend: variation(count, prevCount), n_tone: toneOfTrend(variation(count, prevCount)),
      ticket, ticket_prev: prevTicket, ticket_trend: variation(ticket, prevTicket), ticket_tone: toneOfTrend(variation(ticket, prevTicket)),
      top_linea: top ? { label: top.label, pct: top.pct } : null
    },
    lineas,
    serie: buildSeries(period, rows)
  }
}

// Publicidad: el gasto de la unidad en el mes se reparte entre sus programas por
// su parte de las ventas de esa unidad en ese mes (el criterio de contabilidad).
// Un mes con gasto y sin ventas en la unidad no se puede repartir: se reporta.
export function allocateMarketing (salesRows, spendRows) {
  const salesBy = new Map()
  for (const r of salesRows) {
    const k = `${r.dia.slice(0, 7)}|${r.linea}`
    salesBy.set(k, round((salesBy.get(k) || 0) + Number(r.soles)))
  }
  const spendBy = new Map(spendRows.map(s => [`${s.mes}|${s.linea}`, Number(s.amount)]))
  const allocated = new Map()
  for (const r of salesRows) {
    const k = `${r.dia.slice(0, 7)}|${r.linea}`
    const spend = spendBy.get(k) || 0
    if (!spend || !salesBy.get(k)) continue
    const key = `${r.linea}|${r.program_id}`
    allocated.set(key, (allocated.get(key) || 0) + spend * (Number(r.soles) / salesBy.get(k)))
  }
  const unallocated = round(spendRows
    .filter(s => !salesBy.get(`${s.mes}|${s.linea}`))
    .reduce((sum, s) => sum + Number(s.amount), 0))
  return { allocated, unallocated, total: round(spendRows.reduce((s, r) => s + Number(r.amount), 0)) }
}

// Costo docente de cada edicion = sesiones x horas por sesion x tarifa. Se reparte
// por alumno entre los programas que se VENDIERON (el diplomado carga sus
// cursos); sin alumnos, lo carga el programa de la edicion. Sin tarifa u horario
// la edicion no suma costo y se cuenta aparte para que FICO la complete.
export function allocateInstructorCost (editions) {
  const allocated = new Map()
  const programs = new Map()
  const missing = { sin_tarifa: [], sin_horario: [], sin_docente: [] }
  let total = 0
  for (const ed of editions) {
    const hours = hoursPerSession(ed.horario)
    if (!ed.instructor_id) { missing.sin_docente.push(ed.edition_id); continue }
    if (hours === null) { missing.sin_horario.push(ed.edition_id); continue }
    if (ed.tarifa === null || ed.tarifa === undefined) { missing.sin_tarifa.push(ed.edition_id); continue }
    const cost = Number(ed.sesiones || 0) * hours * Number(ed.tarifa)
    total += cost
    const share = ed.reparto?.length
      ? ed.reparto
      : [{ linea: ed.linea, program_id: ed.program_id, programa: ed.programa, tipo: ed.tipo, n: 1 }]
    const students = share.reduce((s, r) => s + Number(r.n), 0)
    for (const r of share) {
      const key = `${r.linea}|${r.program_id}`
      allocated.set(key, (allocated.get(key) || 0) + cost * (Number(r.n) / students))
      programs.set(key, { linea: r.linea, program_id: r.program_id, programa: r.programa, tipo: r.tipo })
    }
  }
  return { allocated, programs, missing, total: round(total) }
}

// Pestaña Rentabilidad: ingreso vendido - costo docente - publicidad, por programa.
// El tono compara el margen contra el de su unidad: negativo = pierde plata,
// bajo el de su unidad = revisar. No hay una meta de margen definida.
export function buildProfitView ({ period, sales, editions, spend }) {
  const marketing = allocateMarketing(sales, spend)
  const instructor = allocateInstructorCost(editions)

  const byProgram = new Map()
  const rowFor = (key, info) => {
    if (!byProgram.has(key)) byProgram.set(key, { ...info, ingreso: 0, docente: 0, publicidad: 0 })
    return byProgram.get(key)
  }
  for (const s of sales) rowFor(`${s.linea}|${s.program_id}`, s).ingreso += Number(s.soles)
  for (const [key, cost] of instructor.allocated) rowFor(key, instructor.programs.get(key)).docente += cost
  for (const [key, cost] of marketing.allocated) byProgram.get(key).publicidad += cost

  const rows = [...byProgram.values()].map(r => {
    const margen = r.ingreso - r.docente - r.publicidad
    return { ...r, ingreso: round(r.ingreso), docente: round(r.docente), publicidad: round(r.publicidad), margen: round(margen) }
  })
  const lineas = buildTree(rows, ['margen', 'ingreso', 'docente', 'publicidad'], r => r.program_id)
  for (const line of lineas) {
    line.margen_pct = pct(line.margen, line.ingreso)
    for (const tipo of line.tipos) {
      tipo.margen_pct = pct(tipo.margen, tipo.ingreso)
      tipo.tone = toneOfMargin(tipo.margen, tipo.margen_pct, line.margen_pct)
      for (const p of tipo.programas) {
        p.margen_pct = pct(p.margen, p.ingreso)
        p.tone = toneOfMargin(p.margen, p.margen_pct, line.margen_pct)
      }
    }
    line.tone = line.margen < 0 ? 'bad' : 'ok'
  }

  const ingreso = sumBy(rows, 'ingreso')
  const docente = sumBy(rows, 'docente')
  const publicidad = sumBy(rows, 'publicidad')
  const margen = round(ingreso - docente - publicidad)
  const allPrograms = lineas.flatMap(l => l.tipos.flatMap(t => t.programas))
  return {
    period,
    kpis: {
      ingreso, docente, publicidad, margen,
      margen_pct: pct(margen, ingreso),
      // Con costos sin cargar el margen sale inflado: no se pinta de verde.
      margen_tone: margen < 0 ? 'bad' : (instructor.missing.sin_tarifa.length || !marketing.total ? null : 'ok'),
      en_perdida: allPrograms.filter(p => p.margen < 0).length,
      programas: allPrograms.length
    },
    lineas,
    cobertura: {
      ediciones: editions.length,
      sin_tarifa: instructor.missing.sin_tarifa.length,
      sin_horario: instructor.missing.sin_horario.length,
      sin_docente: instructor.missing.sin_docente.length,
      publicidad_cargada: marketing.total,
      publicidad_sin_repartir: marketing.unallocated
    }
  }
}

function toneOfMargin (margen, margenPct, linePct) {
  if (margen < 0) return 'bad'
  if (margenPct !== null && linePct !== null && margenPct < linePct) return 'warn'
  return 'ok'
}

// Publicidad que FICO carga: 12 meses x 4 unidades, montos >= 0.
export function validateMarketingRows (year, rows) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new DomainError('Año invalido')
  return (rows || []).map(r => {
    const month = Number(r.month)
    const amount = Number(r.amount)
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new DomainError('Mes invalido')
    if (!LINE_KEYS.includes(r.line)) throw new DomainError(`Unidad invalida: ${r.line}`)
    if (!Number.isFinite(amount) || amount < 0) throw new DomainError('El monto debe ser 0 o mayor')
    return { month: iso(year, month, 1), line: r.line, amount: round(amount) }
  })
}
