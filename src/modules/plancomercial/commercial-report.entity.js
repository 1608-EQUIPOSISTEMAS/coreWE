import { goalProgress, percentOf } from '../dashboard/results/results.entity.js'

// Informe Comercial de una pagina: las metas del area (plan 2026) que el ERP
// puede medir. Calidad de atencion vive fuera del ERP y Referidos se etiqueta
// DESPUES de vender (convierte ~98 %): ninguno lleva numero, van como pendientes
// de captura para que nadie lea una cifra inventada.

// Meta de conversion por tipo de cliente (catalog.variable_2 de cat_client_moment).
export const CONVERSION_GOALS = { NEW: 15, LDS: 18, CWE: 22 }
export const WEB_CONVERSION_GOAL = 32
export const FOREIGN_SHARE_GOAL = 10
export const REPURCHASE_GOAL = 18
export const REPURCHASE_WINDOW_MONTHS = 12
// Consultas reales / plan de consultas por canal: 45 % es el piso de cumplimiento.
export const LEAD_PLAN_GOAL = 45
export const LEAD_PLAN_CHANNELS = ['MARKETING', 'COMERCIAL', 'WEB', 'OTROS']
export const REPORT_MONTHS = 6
// Bajo esta base una tasa se mueve por 2-3 casos: se muestra el conteo, no el %.
export const MIN_LEADS_FOR_RATE = 30
// Cuanto por debajo de la meta (relativo) sigue siendo "atencion" y no "mal".
const TONE_TOLERANCE = 0.1

export const UNMEASURED_GOALS = [
  { objetivo: 'Calidad de atención 9-10 en el 90 % de clientes', motivo: 'La encuesta no está en el ERP.' },
  { objetivo: 'Conversión 50 % en Programa de Referidos', motivo: 'El referido se etiqueta después de vender; hay que registrarlo como consulta antes.' }
]

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM' de los `n` meses que terminan en `month` (incluido), del mas antiguo
// al mas reciente. Aritmetica de enteros: con Date un 31 salta de mes.
export function lastMonths (month, n = REPORT_MONTHS) {
  const [y, m] = month.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const idx = y * 12 + (m - 1) - (n - 1 - i)
    return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
  })
}

export function monthsBetween (fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

// Tasa con base suficiente; null si no la hay (no es lo mismo que 0 %).
export function rateOf (part, whole, minBase = MIN_LEADS_FOR_RATE) {
  return whole >= minBase ? percentOf(part, whole) : null
}

export function toneVsGoal (valor, meta) {
  if (valor === null || valor === undefined || !meta) return null
  if (valor >= meta) return 'ok'
  return valor >= meta * (1 - TONE_TOLERANCE) ? 'warn' : 'bad'
}

// Meta que corresponde a la MEZCLA de consultas del mes: con muchas NEW (15 %) la
// exigencia baja, con muchas CWE (22 %) sube. Promediar las tres metas mentiria
// cuando la mezcla cambia.
export function weightedConversionGoal (porTipo) {
  let consultas = 0
  let ponderado = 0
  for (const [tipo, meta] of Object.entries(CONVERSION_GOALS)) {
    const n = porTipo[tipo]?.consultas || 0
    consultas += n
    ponderado += n * meta
  }
  return consultas ? Math.round((ponderado / consultas) * 10) / 10 : null
}

const inPeriod = ({ start, end }) => (r) => r.dia >= start && r.dia <= end
const inMonth = (mes) => (r) => r.dia.startsWith(mes)

// Filas { dia, tipo, web, consultas, ventas } ya filtradas -> NEW/LDS/CWE, WEB y
// el total de los tres tipos (consultas sin tipo no tienen meta: quedan fuera).
function conversionOf (rows) {
  const sum = (match) => rows.filter(match).reduce(
    (acc, r) => ({ consultas: acc.consultas + r.consultas, ventas: acc.ventas + r.ventas }),
    { consultas: 0, ventas: 0 })
  const withRate = (x, meta) => {
    const tasa = rateOf(x.ventas, x.consultas)
    return { ...x, tasa, meta, tono: toneVsGoal(tasa, meta) }
  }

  const porTipo = Object.fromEntries(Object.entries(CONVERSION_GOALS)
    .map(([tipo, meta]) => [tipo, withRate(sum((r) => r.tipo === tipo), meta)]))
  const clasificadas = sum((r) => r.tipo in CONVERSION_GOALS)
  return {
    ...porTipo,
    WEB: withRate(sum((r) => r.web), WEB_CONVERSION_GOAL),
    PONDERADA: withRate(clasificadas, weightedConversionGoal(porTipo))
  }
}

// Consultas reales contra el plan de consultas de las ediciones que EMPIEZAN en
// el mes (el plan se carga por edicion). `canales` viene de v_gerencia_funnel con
// claves CANAL_MOMENTO (MARKETING_NUEVO...).
export function leadPlanByChannel (ediciones) {
  const canales = LEAD_PLAN_CHANNELS.map((canal) => {
    let meta = 0
    let consultas = 0
    for (const ed of ediciones) {
      meta += Number(ed.metas_canal?.[canal]?.consultas) || 0
      for (const [clave, v] of Object.entries(ed.canales || {})) {
        if (clave.startsWith(`${canal}_`)) consultas += Number(v.consultas) || 0
      }
    }
    const pct = meta ? percentOf(consultas, meta) : null
    return { canal, meta, consultas, pct, tono: toneVsGoal(pct, LEAD_PLAN_GOAL) }
  })
  const meta = canales.reduce((s, c) => s + c.meta, 0)
  const consultas = canales.reduce((s, c) => s + c.consultas, 0)
  const pct = meta ? percentOf(consultas, meta) : null
  return { meta_pct: LEAD_PLAN_GOAL, meta, consultas, pct, tono: toneVsGoal(pct, LEAD_PLAN_GOAL), canales }
}

// Una cohorte es la gente cuya PRIMERA compra cayo en el mes; se cierra cuando
// pasaron 12 meses. Antes, la tasa es "a la fecha" y solo puede subir.
export function repurchaseCohorts (rows, meses, today) {
  const hoy = today.slice(0, 7)
  return meses.map((mes) => {
    const r = rows.find((x) => x.mes === mes) || { clientes: 0, recompraron: 0 }
    const transcurridos = Math.min(monthsBetween(mes, hoy), REPURCHASE_WINDOW_MONTHS)
    const tasa = percentOf(r.recompraron, r.clientes)
    const cerrada = transcurridos >= REPURCHASE_WINDOW_MONTHS
    return {
      mes,
      clientes: r.clientes,
      recompraron: r.recompraron,
      tasa,
      meses_transcurridos: transcurridos,
      cerrada,
      // Abierta todavia puede subir: pintarla de rojo al mes 2 seria injusto.
      tono: cerrada ? toneVsGoal(tasa, REPURCHASE_GOAL) : null
    }
  })
}

// Dias habiles (lunes a viernes) entre dos fechas 'YYYY-MM-DD', ambas incluidas.
// ponytail: sin feriados, igual que businessDays del panel de lider.
export function businessDaysBetween (start, end) {
  let n = 0
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return n
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1

// Objetivo de vacantes del rango: cada semana del plan aporta en proporcion a los
// dias que comparte con el rango. Sin semanas con objetivo: null, no 0.
export function goalInPeriod (weeks, { start, end }) {
  let meta = null
  for (const w of weeks) {
    const desde = w.date_start > start ? w.date_start : start
    const hasta = w.date_end < end ? w.date_end : end
    if (desde > hasta) continue
    meta = (meta || 0) + Number(w.meta) * daysBetween(desde, hasta) / daysBetween(w.date_start, w.date_end)
  }
  return meta === null ? null : Math.round(meta)
}

// Avance de ventas contra el objetivo del rango: lo que va en curso se juzga por
// los dias habiles ya transcurridos; un rango cerrado, completo.
export function salesProgress ({ logrado, meta, period, today }) {
  const corte = period.end < today ? period.end : today
  const transcurridos = corte < period.start ? 0 : businessDaysBetween(period.start, corte)
  const delMes = businessDaysBetween(period.start, period.end)
  return { logrado, meta, ...goalProgress({ logrado, meta, transcurridos, delMes }) }
}

const EMPTY_SALES = { vivo: 0, membresias: 0, black: 0, con_pais: 0, extranjeros: 0 }
function sumSales (rows) {
  return rows.reduce((acc, r) => {
    for (const k of Object.keys(EMPTY_SALES)) acc[k] += r[k]
    return acc
  }, { ...EMPTY_SALES })
}

function foreignShare (v) {
  const pct = percentOf(v.extranjeros, v.con_pais)
  return { ventas: v.extranjeros, con_pais: v.con_pais, pct, tono: toneVsGoal(pct, FOREIGN_SHARE_GOAL) }
}

// period = { start, end } elegido en pantalla. La serie son los 6 meses que
// terminan en el mes de `end`; las cifras de cabecera, el rango exacto.
export function buildCommercialReport ({ period, today, ventas, conversion, planWeeks, cohortes, ediciones, blackPorVencer }) {
  const meses = lastMonths(period.end.slice(0, 7))
  const monthGoal = (mes) => {
    const semanas = planWeeks.filter((w) => w.mes === mes)
    return semanas.length ? semanas.reduce((s, w) => s + Number(w.meta), 0) : null
  }

  const serie = meses.map((mes) => {
    const v = sumSales(ventas.filter(inMonth(mes)))
    return {
      mes,
      vivo: v.vivo,
      meta_vivo: monthGoal(mes),
      membresias: v.membresias,
      black: v.black,
      extranjeros: foreignShare(v),
      conversion: conversionOf(conversion.filter(inMonth(mes)))
    }
  })
  const rango = sumSales(ventas.filter(inPeriod(period)))

  return {
    periodo: period,
    meses: serie,
    vivo: salesProgress({ logrado: rango.vivo, meta: goalInPeriod(planWeeks, period), period, today }),
    membresias: { logrado: rango.membresias, black: rango.black, meta: null },
    conversion: conversionOf(conversion.filter(inPeriod(period))),
    extranjeros: { ...foreignShare(rango), meta: FOREIGN_SHARE_GOAL },
    recompra: { meta: REPURCHASE_GOAL, cohortes: repurchaseCohorts(cohortes, meses, today) },
    consultas_plan: leadPlanByChannel(ediciones),
    black_por_vencer: blackPorVencer,
    sin_medir: UNMEASURED_GOALS
  }
}
