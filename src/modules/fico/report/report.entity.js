import { percentOf } from '../../dashboard/results/results.entity.js'
import { goalInPeriod, lastMonths, monthsBetween, salesProgress, toneVsGoal } from '../../plancomercial/commercial-report.entity.js'
import { lastDayOfMonth } from '../../plancomercial/plancomercial.entity.js'

// Informe FICO de una pagina: las metas de cobranza del area (plan 2026).
// "Cuota" = la que vence DESPUES del dia de la venta; la inicial o el contado
// se cobran al vender y no son cobranza (eso lo filtra el repository).

export const PAYMENT_COMPLIANCE_GOAL = 85
export const ON_TIME_GOAL = 60
export const MONTHLY_COLLECTION_GOAL = 60000

export const UNMEASURED_GOALS = [
  { objetivo: 'Reducir 5 % mensual la carga tributaria (IGV)', motivo: 'El IGV sale de contabilidad: el ERP no registra comprobantes ni crédito fiscal.' }
]

const inPeriod = ({ start, end }) => (fecha) => fecha >= start && fecha <= end

// Por ALUMNO, no por cuota: quien debe dos cuotas y paga una no cumplio. Solo se
// juzgan cuotas ya vencidas (vence < hoy): la que vence hoy aun puede pagarse.
// cuotas = [{ customer_id, vence, soles, pagada, pagada_el }]
export function studentCompliance (cuotas, today) {
  const porAlumno = new Map()
  const impagas = { cuotas: 0, soles: 0 }
  for (const c of cuotas) {
    if (c.vence >= today) continue
    const a = porAlumno.get(c.customer_id) || { cumple: true, puntual: true }
    // ponytail: pagada sin fila en payments (3 casos en 2026) cuenta como tarde.
    const aTiempo = c.pagada && c.pagada_el !== null && c.pagada_el <= c.vence
    a.cumple &&= c.pagada
    a.puntual &&= aTiempo
    porAlumno.set(c.customer_id, a)
    if (!c.pagada) {
      impagas.cuotas++
      impagas.soles += c.soles
    }
  }
  const alumnos = porAlumno.size
  const cumplen = [...porAlumno.values()].filter((a) => a.cumple).length
  const puntuales = [...porAlumno.values()].filter((a) => a.puntual).length
  const pctCumplen = percentOf(cumplen, alumnos)
  const pctPuntual = percentOf(puntuales, alumnos)
  return {
    alumnos,
    cumplen,
    puntuales,
    tarde: cumplen - puntuales,
    no_pagan: alumnos - cumplen,
    pct_cumplen: pctCumplen,
    tono_cumplen: toneVsGoal(pctCumplen, PAYMENT_COMPLIANCE_GOAL),
    pct_puntual: pctPuntual,
    tono_puntual: toneVsGoal(pctPuntual, ON_TIME_GOAL),
    impagas: { cuotas: impagas.cuotas, soles: Math.round(impagas.soles) }
  }
}

// La meta es mensual: un rango que corta meses la toma en proporcion a los dias.
export function collectionGoal (period) {
  const ultimo = period.end.slice(0, 7)
  const meses = lastMonths(ultimo, monthsBetween(period.start.slice(0, 7), ultimo) + 1)
    .map((mes) => ({ date_start: `${mes}-01`, date_end: lastDayOfMonth(`${mes}-01`), meta: MONTHLY_COLLECTION_GOAL }))
  return goalInPeriod(meses, period)
}

const sumSoles = (rows) => Math.round(rows.reduce((s, r) => s + r.soles, 0))

const daysLate = (vence, today) => Math.round((Date.parse(today) - Date.parse(vence)) / 86400000)

// Tramos de atraso: a los 30 dias un recordatorio basta; pasados los 90 la deuda
// casi siempre termina en retiro.
export const AGING_BUCKETS = [
  { clave: '1-30', label: '1 a 30 días', hasta: 30 },
  { clave: '31-90', label: '31 a 90 días', hasta: 90 },
  { clave: '90+', label: 'Más de 90 días', hasta: Infinity }
]
export const TOP_DEBTORS = 10

// pendientes = [{ enrollment_id, customer_id, alumno, vence, soles }], foto de hoy.
export function debtAging (pendientes, today) {
  const vencidas = pendientes.filter((c) => c.vence < today).map((c) => ({ ...c, dias: daysLate(c.vence, today) }))
  const tramos = AGING_BUCKETS.map(({ clave, label, hasta }, i) => {
    const desde = i ? AGING_BUCKETS[i - 1].hasta : 0
    const del = vencidas.filter((c) => c.dias > desde && c.dias <= hasta)
    return { clave, label, cuotas: del.length, alumnos: new Set(del.map((c) => c.customer_id)).size, soles: sumSoles(del) }
  })
  const porAlumno = new Map()
  for (const c of vencidas) {
    const a = porAlumno.get(c.customer_id) || { alumno: c.alumno, cuotas: 0, soles: 0, dias: 0 }
    a.cuotas++
    a.soles += c.soles
    a.dias = Math.max(a.dias, c.dias)
    porAlumno.set(c.customer_id, a)
  }
  const deudores = [...porAlumno.values()]
    .map((a) => ({ ...a, soles: Math.round(a.soles) }))
    .sort((x, y) => y.soles - x.soles)
  return { total: sumSoles(vencidas), alumnos: deudores.length, tramos, top: deudores.slice(0, TOP_DEBTORS) }
}

// Cuanto de lo que vence termina cobrado, en soles, en los meses ya cerrados.
// cuotas = las de la serie; un mes en curso todavia no dice nada.
export function historicalCollectionRate (cuotas, today) {
  const cerradas = cuotas.filter((c) => c.vence < `${today.slice(0, 7)}-01`)
  const total = cerradas.reduce((s, c) => s + c.soles, 0)
  if (!total) return null
  return cerradas.filter((c) => c.pagada).reduce((s, c) => s + c.soles, 0) / total
}

export const FORECAST_MONTHS = 3

// 'YYYY-MM' + n meses. Aritmetica de enteros: con Date un 31 salta de mes.
function addMonths (mes, n) {
  const [y, m] = mes.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

// El mes en curso y los dos siguientes: lo ya cobrado + lo que falta vencer por
// la tasa historica. ponytail: la meta se mide por fecha de pago y esto por fecha
// de vencimiento; los pagos tardios de meses previos quedan fuera del estimado.
export function collectionForecast ({ pendientes, cobros, tasa, today }) {
  return Array.from({ length: FORECAST_MONTHS }, (_, i) => {
    const mes = addMonths(today.slice(0, 7), i)
    const programado = sumSoles(pendientes.filter((c) => c.vence.startsWith(mes) && c.vence >= today))
    const cobrado = sumSoles(cobros.filter((r) => r.dia.startsWith(mes)))
    const esperado = tasa === null ? null : cobrado + Math.round(programado * tasa)
    return {
      mes,
      cobrado,
      programado,
      esperado,
      meta: MONTHLY_COLLECTION_GOAL,
      falta: esperado === null ? null : Math.max(0, MONTHLY_COLLECTION_GOAL - esperado),
      tono: toneVsGoal(percentOf(esperado, MONTHLY_COLLECTION_GOAL), 100)
    }
  })
}

// El catalogo viejo (we_payment_method_*) y el nuevo (we_payment_medium_*)
// nombran el mismo medio: sin unirlos, Transferencia saldria dos veces.
const LEGACY_METHOD_LABELS = {
  we_payment_method_transfer: 'Transferencia',
  we_payment_method_yape_plin: 'YAPE',
  we_payment_method_cash: 'Efectivo'
}
export const NO_METHOD_LABEL = 'Sin medio registrado'

// filas = [{ alias, medio, pagos, soles }] del rango.
export function collectionByMethod (filas) {
  const porMedio = new Map()
  for (const f of filas) {
    const medio = LEGACY_METHOD_LABELS[f.alias] || f.medio || NO_METHOD_LABEL
    const m = porMedio.get(medio) || { medio, pagos: 0, soles: 0 }
    m.pagos += f.pagos
    m.soles += f.soles
    porMedio.set(medio, m)
  }
  const total = [...porMedio.values()].reduce((s, m) => s + m.soles, 0)
  const medios = [...porMedio.values()]
    .map((m) => ({ ...m, soles: Math.round(m.soles), pct: percentOf(m.soles, total) }))
    .sort((a, b) => b.soles - a.soles)
  return { total: Math.round(total), medios }
}

// period = { start, end } elegido en pantalla. La serie son los 6 meses que
// terminan en el mes de `end`; las cifras de cabecera, el rango exacto. La
// deuda y la proyeccion son la foto de hoy, sea cual sea el periodo.
// cobros = [{ dia, soles }] cobrado por dia de pago.
export function buildFicoReport ({ period, today, cuotas, cobros, pendientes = [], porMedio = [] }) {
  const serie = lastMonths(period.end.slice(0, 7)).map((mes) => {
    const delMes = (fecha) => fecha.startsWith(mes)
    const cobrado = sumSoles(cobros.filter((r) => delMes(r.dia)))
    const delPeriodo = { start: `${mes}-01`, end: lastDayOfMonth(`${mes}-01`) }
    return {
      mes,
      cobrado,
      meta_cobranza: MONTHLY_COLLECTION_GOAL,
      // El mes en curso se juzga por su ritmo, no contra el mes completo.
      tono_cobranza: salesProgress({ logrado: cobrado, meta: MONTHLY_COLLECTION_GOAL, period: delPeriodo, today }).tono,
      ...studentCompliance(cuotas.filter((c) => delMes(c.vence)), today)
    }
  })
  const enRango = inPeriod(period)
  const tasa = historicalCollectionRate(cuotas, today)

  return {
    periodo: period,
    meses: serie,
    cobranza: salesProgress({
      logrado: sumSoles(cobros.filter((r) => enRango(r.dia))),
      meta: collectionGoal(period),
      period,
      today
    }),
    alumnos: studentCompliance(cuotas.filter((c) => enRango(c.vence)), today),
    deuda: debtAging(pendientes, today),
    proyeccion: {
      tasa: tasa === null ? null : Math.round(tasa * 1000) / 10,
      meses: collectionForecast({ pendientes, cobros, tasa, today })
    },
    medios: collectionByMethod(porMedio),
    metas: { cumplen: PAYMENT_COMPLIANCE_GOAL, puntual: ON_TIME_GOAL, cobranza_mensual: MONTHLY_COLLECTION_GOAL },
    sin_medir: UNMEASURED_GOALS
  }
}
