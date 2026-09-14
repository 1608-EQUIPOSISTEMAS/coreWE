import {
  TONE, RANKING_LIMIT, median, ratioOf, percentOf, toneHigherIsBetter, businessDays, goalProgress, formatSoles
} from './results.entity.js'
import { widget, monthAgo, previousMonths, monthlyChart, differenceText, row } from './area-widgets.entity.js'

// Panel de Fundación: "¿llegamos a la meta del evento?", ventas del canal y
// becas otorgadas por el asesor FWE.

// A más de una semana del evento casi nadie compró todavía: con un solo evento
// con meta no hay curva histórica de "esperado a la fecha", así que antes de
// esa ventana el avance se informa sin semáforo en vez de pintarlo de rojo.
export const EVENT_TONE_WINDOW_DAYS = 7

const FUNDACION_AREA = '1.5'

export function buildFundacionResults (
  { tramo = {}, ventasPorMes = [], programas = [], becasPorMes = [], evento = null },
  now = new Date()
) {
  const becas = becasSummary(becasPorMes, now)
  const filas = evento
    ? [
        row('hero', [eventChartWidget(evento), monthComparisonWidget(tramo, becasPorMes)]),
        row('mitad', [eventGaugeWidget(evento), becasChartWidget(becasPorMes, becas, now)]),
        row('tercios', [programsRankingWidget(programas), categoryDonutWidget(evento), becasMetricsWidget(becas)])
      ]
    : [
        row('hero', [salesChartWidget(ventasPorMes, now), monthComparisonWidget(tramo, becasPorMes)]),
        row('tercios', [programsRankingWidget(programas), becasChartWidget(becasPorMes, becas, now), becasMetricsWidget(becas)])
      ]
  return {
    titular: evento ? eventHeadline(evento) : salesHeadline(tramo),
    tarjetas: [eventCard(evento), ventasCard(tramo), ingresoCard(tramo), becasCard(becas)],
    filas: filas.filter(Boolean)
  }
}

const EVENTS_ROUTE = { ruta: '/fundacion/eventos', texto: 'Ver eventos' }

// ── Evento ───────────────────────────────────────────────────────────────

export function eventProgress (evento) {
  const areas = fundacionAreas(evento)
  const meta = evento.meta ?? {}
  return [
    { categoria: 'VIP', real: sumOf(areas, 'vip'), meta: Number(meta.vip ?? 0) },
    { categoria: 'General', real: sumOf(areas, 'general'), meta: Number(meta.general ?? 0) }
  ]
}

const fundacionAreas = (evento) => (evento.areas ?? []).filter(a => a.area_code === FUNDACION_AREA)
const sumOf = (rows, key) => rows.reduce((total, r) => total + Number(r[key] ?? 0), 0)

function eventTotals (evento) {
  const categorias = eventProgress(evento)
  const real = categorias.reduce((t, c) => t + c.real, 0)
  const meta = categorias.reduce((t, c) => t + c.meta, 0)
  return { categorias, real, meta, ratio: ratioOf(real, meta) }
}

function eventTone (evento, ratio) {
  return evento.dias <= EVENT_TONE_WINDOW_DAYS ? toneHigherIsBetter(ratio) : null
}

function eventHeadline (evento) {
  const { real, meta, ratio } = eventTotals(evento)
  return {
    texto: `${real} de ${meta} entradas para ${evento.evento}. ${whenSentence(evento)}`,
    tono: eventTone(evento, ratio)
  }
}

function whenSentence ({ dias, inicio }) {
  if (dias < 0) return `Fue el ${inicio}.`
  if (dias === 0) return 'Es hoy.'
  return dias === 1 ? 'Falta 1 día.' : `Faltan ${dias} días.`
}

// Dice QUÉ empujar: la categoría a la que más entradas le faltan.
function laggingSentence (categorias) {
  const peor = categorias
    .map(c => ({ ...c, faltan: c.meta - c.real }))
    .sort((a, b) => b.faltan - a.faltan)[0]
  if (!peor || peor.faltan <= 0) return 'Todas las categorías llegaron a su meta.'
  return `A ${peor.categoria} le faltan ${peor.faltan} ${peor.faltan === 1 ? 'entrada' : 'entradas'}.`
}

function eventCard (evento) {
  const base = { label: 'Entradas del evento', unidad: 'num', icono: 'fa-ticket' }
  if (!evento) return { ...base, valor: null, ratio: null, tono: null, comparativo: 'sin evento con meta cargada' }
  const { real, meta, ratio } = eventTotals(evento)
  return { ...base, valor: real, ratio, tono: eventTone(evento, ratio), comparativo: `meta Fundación: ${meta}` }
}

function eventChartWidget (evento) {
  const { categorias, ratio } = eventTotals(evento)
  return widget('grafico', '¿Cuánto falta para la meta del evento?', {
    pista: evento.evento,
    grafico: {
      tipo: 'barras-h',
      unidad: 'num',
      categorias: categorias.map(c => c.categoria),
      series: [
        { nombre: 'Vendidas', datos: categorias.map(c => c.real), rol: 'principal' },
        { nombre: 'Meta', datos: categorias.map(c => c.meta), rol: 'referencia' }
      ],
      referencia: null
    },
    insight: { texto: `${whenSentence(evento)} ${laggingSentence(categorias)}`, tono: eventTone(evento, ratio) },
    verTodo: EVENTS_ROUTE
  })
}

function eventGaugeWidget (evento) {
  const { real, meta, ratio } = eventTotals(evento)
  const faltan = Math.max(0, meta - real)
  return widget('medidor', 'Avance de la meta del evento', {
    pista: evento.evento,
    pct: percentOf(real, meta),
    etiqueta: 'de la meta',
    tono: eventTone(evento, ratio),
    leyenda: [
      { label: 'Vendidas', valor: real, tono: TONE.OK },
      { label: 'Faltan', valor: faltan, tono: faltan ? TONE.BAD : TONE.OK }
    ],
    insight: { texto: whenSentence(evento), tono: null },
    verTodo: { ruta: '/fundacion/objetivos', texto: 'Ver objetivos' }
  })
}

// Qué tipo de entrada compra la gente de Fundación. null sin entradas: una dona
// vacía no dice nada.
function categoryDonutWidget (evento) {
  const areas = fundacionAreas(evento)
  const segmentos = [
    { label: 'VIP', valor: sumOf(areas, 'vip'), tono: 'principal' },
    { label: 'Premium', valor: sumOf(areas, 'premium'), tono: 'secundario' },
    { label: 'General', valor: sumOf(areas, 'general'), tono: 'secundario' },
    { label: 'Virtual', valor: sumOf(areas, 'virtual'), tono: 'neutro' }
  ].filter(s => s.valor > 0)
  const total = segmentos.reduce((t, s) => t + s.valor, 0)
  if (!total) return null
  const vip = segmentos.find(s => s.label === 'VIP')?.valor ?? 0
  return widget('dona', 'Entradas por categoría', {
    pista: 'acreditadas a Fundación',
    unidad: 'num',
    total,
    etiquetaTotal: 'entradas',
    segmentos,
    insight: { texto: `El ${percentOf(vip, total)}% de las entradas es VIP.`, tono: null }
  })
}

// ── Ventas del mes ───────────────────────────────────────────────────────

// Sin evento con meta, lo único que Fundación puede mirar es cómo vende el mes.
function salesHeadline ({ ventas = 0, ventas_prev: prev = 0 }) {
  const ratio = ratioOf(ventas, prev)
  return {
    texto: `${ventas} ventas en lo que va del mes, contra ${prev} en el mismo tramo del mes anterior.`,
    tono: toneHigherIsBetter(ratio)
  }
}

function ventasCard (tramo) {
  const ratio = ratioOf(tramo.ventas, tramo.ventas_prev)
  return {
    label: 'Ventas del mes',
    valor: tramo.ventas ?? 0,
    unidad: 'num',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-cart-shopping',
    comparativo: `mismo tramo del mes anterior: ${tramo.ventas_prev ?? 0}`
  }
}

function ingresoCard (tramo) {
  const ratio = ratioOf(tramo.monto, tramo.monto_prev)
  return {
    label: 'Ingreso del mes',
    valor: tramo.monto ?? 0,
    unidad: 'soles',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-sack-dollar',
    comparativo: `mismo tramo del mes anterior: ${formatSoles(tramo.monto_prev)}`
  }
}

// Las becas se comparan contra el mes anterior COMPLETO (no hay tramo diario de
// becas); por eso la barra lo dice en su etiqueta.
function monthComparisonWidget (tramo, becasPorMes) {
  const ratio = ratioOf(tramo.ventas, tramo.ventas_prev)
  return widget('comparativo', 'Mes contra el anterior', {
    pista: 'del 1 al día de hoy',
    valor: tramo.ventas ?? 0,
    unidad: 'num',
    etiqueta: 'ventas en lo que va del mes',
    ratio,
    tono: toneHigherIsBetter(ratio),
    contra: 'mismo tramo del mes anterior',
    barras: [
      { label: 'Ventas', actual: tramo.ventas ?? 0, anterior: tramo.ventas_prev ?? 0, unidad: 'num' },
      { label: 'Ingreso', actual: tramo.monto ?? 0, anterior: tramo.monto_prev ?? 0, unidad: 'soles' },
      {
        label: 'Becas (contra el mes anterior completo)',
        actual: monthAgo(becasPorMes, 0)?.becas ?? 0,
        anterior: monthAgo(becasPorMes, 1)?.becas ?? 0,
        unidad: 'num'
      }
    ],
    insight: revenueInsight(tramo)
  })
}

function revenueInsight ({ monto = 0, monto_prev: prev = 0 }) {
  const ratio = ratioOf(monto, prev)
  if (ratio === null) return { texto: 'El mes anterior a esta fecha no hubo ingreso con qué comparar.', tono: null }
  // "100% bajo" es exacto pero no se entiende; en cero se dice con palabras.
  if (!monto) {
    return { texto: `Todavía no hay ingreso este mes; a esta fecha del mes anterior iban ${formatSoles(prev)}.`, tono: toneHigherIsBetter(ratio) }
  }
  return { texto: `El ingreso va ${differenceText(ratio)} el mismo tramo del mes anterior.`, tono: toneHigherIsBetter(ratio) }
}

function salesChartWidget (ventasPorMes, now) {
  const grafico = monthlyChart({ serie: 'Ventas', unidad: 'num', rows: ventasPorMes, valorDelMes: r => r.ventas, now })
  if (!grafico) return null
  return widget('grafico', '¿Cuántas ventas hace Fundación por mes?', {
    pista: 'últimos 7 meses',
    grafico,
    insight: projectionInsight({ actual: monthAgo(ventasPorMes, 0)?.ventas ?? 0, previos: previousMonths(ventasPorMes).map(r => r.ventas), now, cosa: 'ventas' })
  })
}

// Al ritmo de los días hábiles transcurridos, ¿cómo cierra el mes contra un mes típico?
function projectionInsight ({ actual, previos, now, cosa }) {
  const mediana = median(previos)
  // Contra una mediana en cero no hay "mes típico" que comparar.
  if (!mediana) return null
  const { proyeccion } = goalProgress({ logrado: actual, meta: null, ...businessDays(now) })
  return {
    texto: `Al ritmo actual el mes cierra con ${proyeccion} ${cosa}; la mediana es ${mediana}.`,
    tono: toneHigherIsBetter(ratioOf(proyeccion, mediana))
  }
}

function programsRankingWidget (programas) {
  return widget('ranking', `Top ${RANKING_LIMIT} programas vendidos por Fundación en el mes`, {
    pista: 'por cantidad de ventas',
    unidad: 'num',
    items: programas.slice(0, RANKING_LIMIT).map(p => ({
      label: p.programa,
      sublabel: formatSoles(p.monto),
      valor: p.ventas,
      tono: null,
      ruta: null
    })),
    insight: programas.length ? null : { texto: 'Todavía no hay ventas de Fundación este mes.', tono: null },
    verTodo: EVENTS_ROUTE
  })
}

// ── Becas ────────────────────────────────────────────────────────────────

// El mes en curso va a medias: se compara su PROYECCIÓN al cierre contra la
// mediana de los 6 meses completos anteriores.
function becasSummary (becasPorMes, now) {
  const actual = monthAgo(becasPorMes, 0) ?? { becas: 0, certificado_pagado: 0 }
  const mediana = median(previousMonths(becasPorMes).map(m => m.becas))
  const { proyeccion } = goalProgress({ logrado: actual.becas, meta: null, ...businessDays(now) })
  const ratio = ratioOf(proyeccion, mediana)
  return {
    actual: actual.becas,
    mediana,
    proyeccion,
    ratio,
    tono: mediana ? toneHigherIsBetter(ratio) : null,
    pagado: percentOf(actual.certificado_pagado, actual.becas)
  }
}

function becasCard (becas) {
  return {
    label: 'Becas otorgadas (FWE)',
    valor: becas.actual,
    unidad: 'num',
    ratio: becas.ratio,
    tono: becas.tono,
    icono: 'fa-graduation-cap',
    comparativo: `proyección ${becas.proyeccion}, mediana ${becas.mediana ?? '—'} al mes`
  }
}

function becasChartWidget (becasPorMes, becas, now) {
  const grafico = monthlyChart({ serie: 'Becas', unidad: 'num', rows: becasPorMes, valorDelMes: r => r.becas, now })
  if (!grafico) return null
  return widget('grafico', '¿Cuántas becas se otorgan por mes?', {
    pista: 'canal FWE, últimos 7 meses',
    grafico,
    insight: !becas.mediana
      ? null
      : { texto: `Al ritmo actual el mes cierra con ${becas.proyeccion} becas; la mediana es ${becas.mediana}.`, tono: becas.tono }
  })
}

function becasMetricsWidget (becas) {
  return widget('metricas', 'Becas', {
    pista: 'canal FWE',
    items: [
      { label: 'Otorgadas este mes', valor: becas.actual, unidad: 'num', tono: null, nota: null },
      { label: 'Con certificado pagado', valor: becas.pagado, unidad: 'pct', tono: null, nota: null },
      {
        label: 'Proyección al cierre',
        valor: becas.proyeccion,
        unidad: 'num',
        tono: becas.tono,
        nota: becas.mediana === null ? 'sin histórico' : `mediana ${becas.mediana} al mes`
      }
    ]
  })
}
