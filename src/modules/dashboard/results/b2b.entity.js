import {
  RANKING_LIMIT, TONE, median, ratioOf, percentOf, toneHigherIsBetter, businessDays, goalProgress, formatSoles
} from './results.entity.js'
import { widget, monthAgo, previousMonths, monthlyChart, differenceText, row } from './area-widgets.entity.js'

// Panel B2B: "¿cuánto cobramos y cuánto vendimos?". Sin metas en BD: todo se
// compara contra el histórico (decisión del usuario).

export function buildB2bResults ({ cobranzaPorMes = [], ventasPorMes = [], leads = {}, programas = [] }, now = new Date()) {
  const cobranza = cobranzaSummary(cobranzaPorMes)
  const ventas = ventasSummary(ventasPorMes, now)
  const conversion = conversionSummary(leads)
  return {
    titular: headline(cobranza, now),
    tarjetas: [cobranzaCard(cobranza), ventasCard(ventas), conversionCard(conversion), cuposCard(ventas)],
    filas: [
      row('hero', [cobranzaChartWidget(cobranzaPorMes, now), cobranzaComparisonWidget(cobranza, ventas, leads, now)]),
      row('mitad', [ventasChartWidget(ventasPorMes, ventas, now), compositionDonutWidget(ventas)]),
      row('tercios', [conversionGaugeWidget(conversion, leads), programsRankingWidget(programas), pipelineMetricsWidget(leads)])
    ].filter(Boolean)
  }
}

// ── Resúmenes (una sola vez; tarjetas y widgets leen de aquí) ───────────

// Del 1 al día de hoy contra el mismo tramo del mes anterior: la cobranza B2B
// llega a golpes (un contrato grande), así que la mediana de 6 meses completos va
// solo de referencia.
function cobranzaSummary (rows) {
  const actual = monthAgo(rows, 0)?.monto_al_dia ?? 0
  const tramoAnterior = monthAgo(rows, 1)?.monto_al_dia ?? 0
  const ratio = ratioOf(actual, tramoAnterior)
  return { actual, tramoAnterior, mediana: median(previousMonths(rows).map(r => r.monto)), ratio, tono: toneHigherIsBetter(ratio) }
}

// El mes va a medias: su proyección al cierre contra la mediana de 6 meses.
function ventasSummary (rows, now) {
  const actual = monthAgo(rows, 0) ?? { ventas: 0, monto: 0, cupos: 0 }
  const mediana = median(previousMonths(rows).map(r => r.ventas))
  const { proyeccion } = goalProgress({ logrado: actual.ventas, meta: null, ...businessDays(now) })
  const ratio = ratioOf(proyeccion, mediana)
  return {
    ventas: actual.ventas,
    monto: actual.monto,
    cupos: actual.cupos,
    anterior: monthAgo(rows, 1)?.ventas ?? 0,
    mediana,
    proyeccion,
    ratio,
    tono: toneHigherIsBetter(ratio)
  }
}

// Las cohortes recientes aún no maduran; ambos tramos (90 y 90 días previos)
// tienen el mismo sesgo, así que la comparación entre ellos sigue siendo justa.
function conversionSummary (leads) {
  const actual = percentOf(leads.pagados, leads.leads)
  const anterior = percentOf(leads.pagados_prev, leads.leads_prev)
  const ratio = ratioOf(actual, anterior)
  return { actual, anterior, ratio, tono: toneHigherIsBetter(ratio) }
}

// ── Veredicto y tarjetas ────────────────────────────────────────────────

function headline (cobranza, now) {
  const cobrado = `Cobranza al día ${now.getDate()}: ${formatSoles(cobranza.actual)}`
  if (cobranza.ratio === null) {
    return { texto: `${cobrado}; el mes anterior a esta fecha no hubo cobros con qué comparar.`, tono: null }
  }
  // "100% bajo" es exacto pero no se entiende; sin cobros se dice con palabras.
  if (!cobranza.actual) {
    return {
      texto: `Al día ${now.getDate()} todavía no hay cobros; a esta fecha del mes anterior iban ${formatSoles(cobranza.tramoAnterior)}.`,
      tono: cobranza.tono
    }
  }
  return { texto: `${cobrado}, ${differenceText(cobranza.ratio)} el mismo tramo del mes anterior.`, tono: cobranza.tono }
}

function cobranzaCard (cobranza) {
  return {
    label: 'Cobranza B2B del mes',
    valor: cobranza.actual,
    unidad: 'soles',
    ratio: cobranza.ratio,
    tono: cobranza.tono,
    icono: 'fa-hand-holding-dollar',
    comparativo: `mismo tramo del mes anterior: ${formatSoles(cobranza.tramoAnterior)}`
  }
}

function ventasCard (ventas) {
  return {
    label: 'Ventas B2B del mes',
    valor: ventas.ventas,
    unidad: 'num',
    ratio: ventas.ratio,
    tono: ventas.tono,
    icono: 'fa-handshake',
    comparativo: `proyección ${ventas.proyeccion}, mediana ${ventas.mediana ?? '—'} al mes`
  }
}

function conversionCard (conversion) {
  return {
    label: 'Conversión de leads B2B',
    valor: conversion.actual,
    unidad: 'pct',
    ratio: conversion.ratio,
    tono: conversion.tono,
    icono: 'fa-filter',
    comparativo: `90 días previos: ${conversion.anterior ?? '—'}%`
  }
}

// Un cupo es venta en S/0: el convenio se cobra en el contrato. No es bueno ni
// malo, por eso va sin semáforo.
function cuposCard (ventas) {
  return {
    label: 'Cupos en S/0 del mes',
    valor: ventas.cupos,
    unidad: 'num',
    ratio: null,
    tono: null,
    icono: 'fa-ticket',
    comparativo: `de ${ventas.ventas} ventas B2B del mes`
  }
}

// ── Widgets ─────────────────────────────────────────────────────────────

function cobranzaChartWidget (rows, now) {
  const grafico = monthlyChart({
    serie: 'Cobrado',
    unidad: 'soles',
    rows,
    // El mes en curso va al día: su total todavía no es comparable.
    valorDelMes: (r) => (r.meses_atras === 0 ? r.monto_al_dia : r.monto),
    now
  })
  if (!grafico) return null
  return widget('grafico', '¿Cómo viene la cobranza?', {
    pista: 'últimos 7 meses',
    grafico,
    verTodo: { ruta: '/business/contracts', texto: 'Ver contratos' }
  })
}

// Cuánto de un mes típico ya entró: con cobros a golpes, es la lectura justa del
// mes en curso contra la mediana.
function cobranzaComparisonWidget (cobranza, ventas, leads, now) {
  // Sin cobros ni tramo anterior no hay comparación: sería un panel de ceros.
  if (!cobranza.actual && cobranza.ratio === null) return null
  const deUnMesTipico = percentOf(cobranza.actual, cobranza.mediana)
  return widget('comparativo', 'Cobranza contra el mes anterior', {
    pista: 'del 1 al día de hoy',
    valor: cobranza.actual,
    unidad: 'soles',
    etiqueta: `cobrado al día ${now.getDate()}`,
    ratio: cobranza.ratio,
    tono: cobranza.tono,
    contra: 'mismo tramo del mes anterior',
    barras: [
      { label: 'Cobranza al día', actual: cobranza.actual, anterior: cobranza.tramoAnterior, unidad: 'soles' },
      { label: 'Ventas (contra el mes anterior completo)', actual: ventas.ventas, anterior: ventas.anterior, unidad: 'num' },
      { label: 'Leads (90 días contra los 90 previos)', actual: leads.leads ?? 0, anterior: leads.leads_prev ?? 0, unidad: 'num' }
    ],
    // En cero el titular ya lo dice; "0% de un mes típico" solo repite.
    insight: !deUnMesTipico
      ? null
      : { texto: `Lo cobrado equivale al ${deUnMesTipico}% de un mes típico (mediana ${formatSoles(cobranza.mediana)}).`, tono: null }
  })
}

function ventasChartWidget (rows, ventas, now) {
  const grafico = monthlyChart({ serie: 'Ventas', unidad: 'num', rows, valorDelMes: (r) => r.ventas, now })
  if (!grafico) return null
  return widget('grafico', '¿Cuántas ventas cerramos por mes?', {
    pista: 'últimos 7 meses',
    grafico,
    insight: ventas.mediana === null
      ? null
      : { texto: `Al ritmo actual el mes cierra con ${ventas.proyeccion} ventas; la mediana es ${ventas.mediana}.`, tono: ventas.tono }
  })
}

// null sin ventas: una dona vacía no dice nada.
function compositionDonutWidget (ventas) {
  if (!ventas.ventas) return null
  return widget('dona', '¿Cómo se componen las ventas del mes?', {
    pista: 'pagadas y cupos',
    unidad: 'num',
    total: ventas.ventas,
    etiquetaTotal: 'ventas',
    segmentos: [
      { label: 'Con monto', valor: ventas.ventas - ventas.cupos, tono: 'principal' },
      { label: 'Cupos en S/0', valor: ventas.cupos, tono: 'neutro' }
    ],
    insight: { texto: `${formatSoles(ventas.monto)} vendidos; el dinero de los cupos entra por el contrato.`, tono: null }
  })
}

// null sin leads: un 0% sin base no es una conversión.
function conversionGaugeWidget (conversion, leads) {
  if (!leads.leads) return null
  const pagados = leads.pagados ?? 0
  return widget('medidor', 'Conversión de leads B2B', {
    pista: 'leads de los últimos 90 días',
    pct: conversion.actual,
    etiqueta: 'convertidos',
    tono: conversion.tono,
    leyenda: [
      { label: 'Pagados', valor: pagados, tono: TONE.OK },
      { label: 'Sin pago', valor: leads.leads - pagados, tono: null }
    ],
    insight: conversion.anterior === null
      ? null
      : { texto: `90 días previos: ${conversion.anterior}%. Las cohortes recientes todavía maduran.`, tono: conversion.tono },
    verTodo: { ruta: '/b2b/leads', texto: 'Ver leads' }
  })
}

// Por programa y no por empresa: la venta B2B de 2026 no guarda empresa ni contrato.
function programsRankingWidget (programas) {
  return widget('ranking', `Top ${RANKING_LIMIT} programas B2B del mes`, {
    pista: 'la venta todavía no guarda la empresa',
    unidad: 'num',
    items: programas.slice(0, RANKING_LIMIT).map(p => ({
      label: p.programa,
      sublabel: formatSoles(p.monto),
      valor: p.ventas,
      tono: null,
      ruta: null
    })),
    insight: programas.length ? null : { texto: 'Todavía no hay ventas B2B este mes.', tono: null },
    verTodo: { ruta: '/business/companies', texto: 'Ver empresas' }
  })
}

function pipelineMetricsWidget (leads) {
  return widget('metricas', 'Pipeline', {
    pista: 'leads B2B',
    items: [
      { label: 'Leads del mes', valor: leads.leads_mes ?? 0, unidad: 'num', tono: null, nota: null },
      { label: 'Leads de 90 días', valor: leads.leads ?? 0, unidad: 'num', tono: null, nota: `${leads.leads_prev ?? 0} los 90 previos` },
      { label: 'Pagados de 90 días', valor: leads.pagados ?? 0, unidad: 'num', tono: null, nota: `${leads.pagados_prev ?? 0} los 90 previos` }
    ],
    insight: {
      texto: 'Uso de cupos de contratos y cartera por sector aún no medibles: la venta no se enlaza al contrato ni a la empresa.',
      tono: null
    }
  })
}
