import {
  TONE, median, ratioOf, percentOf, toneHigherIsBetter, toneLowerIsBetter, RANKING_LIMIT, TABLE_LIMIT
} from './results.entity.js'
import { MONTHS_ES } from '../dashboard.entity.js'

// Producto responde "¿qué ediciones se van a caer?".

// Una edición a 14 días o menos de su inicio con menos de la mitad de su meta
// ya no llega por inercia: es cuando todavía se puede empujar o reprogramar.
export const RISK_DAYS = 14
export const RISK_FILL = 0.5

const CRONOGRAMA = '/producto/cronograma-vista'

export function buildProductoResults ({ proximas = [], llenadoT14 = [], cancelacion = [], planificacion = {} }, now = new Date()) {
  const mesActual = monthKey(now)
  const enRiesgo = editionsAtRisk(proximas)
  const t14 = fillAtT14(llenadoT14, mesActual)
  const proximo = upcomingFill(proximas)
  const cancel = cancellation(cancelacion, mesActual)

  return {
    titular: headline(enRiesgo.length, t14),
    tarjetas: [upcomingCard(proximo), t14Card(t14), riskCard(enRiesgo), cancellationCard(cancel)],
    filas: [
      { disposicion: 'hero', widgets: [fillAtT14Widget(llenadoT14, t14), fillComparisonWidget(t14, proximo)] },
      { disposicion: 'mitad', widgets: [riskRanking(enRiesgo), upcomingDonut(proximas, proximo)] },
      { disposicion: 'tercios', widgets: [cancellationWidget(cancelacion, cancel), upcomingGauge(proximo), planningMetrics(planificacion, proximo)] },
      { disposicion: 'completa', widgets: [nextTwoWeeksTable(proximas)] }
    ]
  }
}

// El riesgo manda: si hay ediciones por caerse es lo primero que el líder debe
// leer. Sin riesgo, el llenado a 14 días dice si la siguiente tanda viene sana.
function headline (enRiesgo, t14) {
  const riesgo = enRiesgo === 0
    ? 'Ninguna edición de las próximas 2 semanas está en riesgo.'
    : `${enRiesgo} ${enRiesgo === 1 ? 'edición puede caerse' : 'ediciones pueden caerse'} en las próximas 2 semanas.`
  const llenado = t14.valor !== null && t14.referencia !== null
    ? ` Llegan a 14 días del inicio con ${t14.valor}% de la meta; lo típico es ${t14.referencia}%.`
    : ''
  return {
    texto: riesgo + llenado,
    tono: enRiesgo ? TONE.BAD : (toneHigherIsBetter(t14.ratio) ?? TONE.OK)
  }
}

// ── Reglas ──────────────────────────────────────────────────────────────

function editionsAtRisk (proximas) {
  return proximas
    .filter(e => e.dias <= RISK_DAYS && fillBand(e) === TONE.BAD)
    .sort((a, b) => a.dias - b.dias || a.ventas / a.meta_ventas - b.ventas / b.meta_ventas)
}

// Llena (100% o más), a medio camino (desde RISK_FILL) o bajo: la misma banda
// pinta la dona, la tabla y decide el riesgo. Sin meta no hay banda.
function fillBand ({ ventas, meta_ventas: meta }) {
  if (!(meta > 0)) return null
  const fill = ventas / meta
  if (fill >= 1) return TONE.OK
  return fill >= RISK_FILL ? TONE.WARN : TONE.BAD
}

function upcomingFill (proximas) {
  const conMeta = proximas.filter(e => e.meta_ventas > 0)
  const ventas = sum(conMeta, 'ventas')
  const meta = sum(conMeta, 'meta_ventas')
  return { ediciones: conMeta.length, sinMeta: proximas.length - conMeta.length, ventas, meta, pct: percentOf(ventas, meta) }
}

const fillPct = (fila) => percentOf(fila.ventas, fila.meta)

function fillAtT14 (llenadoT14, mesActual) {
  const actual = llenadoT14.find(f => f.mes === mesActual)
  const referencia = median(llenadoT14.filter(f => f.mes < mesActual).map(fillPct))
  const valor = actual ? fillPct(actual) : null
  return { actual, valor, referencia, ratio: ratioOf(valor, referencia) }
}

const cancellationPct = (fila) => percentOf(fila.canceladas, fila.cursos)

function cancellation (cancelacion, mesActual) {
  const actual = cancelacion.find(f => f.mes === mesActual)
  const previos = cancelacion.filter(f => f.mes < mesActual).map(cancellationPct).filter(v => v !== null)
  const referencia = previos.length
    ? Math.round((previos.reduce((a, v) => a + v, 0) / previos.length) * 10) / 10
    : null
  const valor = actual ? cancellationPct(actual) : null
  return { actual, valor, referencia, ratio: ratioOf(valor, referencia) }
}

// ── Tarjetas ────────────────────────────────────────────────────────────

// Sin semáforo a propósito: a 30 días del inicio lo normal es ir bajo, y
// pintarlo de rojo acusaría a ediciones sanas. El juicio lo da el T-14.
function upcomingCard ({ ediciones, ventas, meta, pct }) {
  return {
    label: 'Llenado de las que inician en 30 días',
    valor: pct,
    unidad: 'pct',
    ratio: null,
    tono: null,
    icono: 'fa-users',
    comparativo: `${ventas} de ${meta} vacantes en ${ediciones} ediciones`
  }
}

function t14Card ({ valor, referencia, ratio }) {
  return {
    label: 'Llenado a 14 días del inicio',
    valor,
    unidad: 'pct',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-hourglass-half',
    comparativo: referencia === null ? 'sin histórico' : `típico: ${referencia}% (mediana de 3 meses)`
  }
}

function riskCard (enRiesgo) {
  return {
    label: 'Ediciones en riesgo',
    valor: enRiesgo.length,
    unidad: 'num',
    ratio: null,
    tono: enRiesgo.length ? TONE.BAD : TONE.OK,
    icono: 'fa-triangle-exclamation',
    comparativo: `inician en ${RISK_DAYS} días bajo el ${RISK_FILL * 100}% de la meta`
  }
}

function cancellationCard ({ actual, valor, referencia, ratio }) {
  return {
    label: 'Cancelación (A5) del mes',
    valor,
    unidad: 'pct',
    ratio,
    tono: toneLowerIsBetter(ratio),
    icono: 'fa-ban',
    comparativo: referencia === null
      ? 'sin histórico'
      : `promedio 6 meses: ${referencia}%${actual ? `, ${actual.canceladas} de ${actual.cursos} cursos` : ''}`
  }
}

// ── Widgets ─────────────────────────────────────────────────────────────

// Mismo dato que la tarjeta, pero mes a mes: deja ver si el mes flojo es una
// tendencia o un tropiezo.
function fillAtT14Widget (llenadoT14, { valor, referencia, ratio }) {
  return {
    tipo: 'grafico',
    titulo: '¿Llegamos a los 14 días con el aula armada?',
    pista: 'Por mes del corte',
    grafico: {
      tipo: 'barras',
      unidad: 'pct',
      categorias: llenadoT14.map(f => monthLabel(f.mes)),
      series: [{ nombre: 'Llenado a 14 días', datos: llenadoT14.map(fillPct), rol: 'principal' }],
      referencia: referencia === null ? null : { valor: referencia, etiqueta: 'típico' }
    },
    insight: valor !== null && referencia !== null
      ? { texto: `Este mes llegan con ${valor}% de la meta; lo típico es ${referencia}%.`, tono: toneHigherIsBetter(ratio) }
      : null,
    verTodo: { ruta: CRONOGRAMA, texto: 'Ver cronograma' }
  }
}

// Dos lecturas del mismo problema: cómo llegan las que ya pasaron su corte
// (contra lo típico) y cuánto falta vender en las que vienen (contra su meta).
function fillComparisonWidget (t14, { ediciones, ventas, meta }) {
  const faltan = meta - ventas
  return {
    tipo: 'comparativo',
    titulo: '¿Cómo va el llenado contra lo típico?',
    pista: 'Mes actual',
    valor: t14.valor,
    unidad: 'pct',
    etiqueta: 'llenado a 14 días del inicio',
    ratio: t14.ratio,
    tono: toneHigherIsBetter(t14.ratio),
    contra: 'vs lo típico',
    barras: [
      { label: 'Llenado a 14 días (este mes / típico)', actual: t14.valor, anterior: t14.referencia, unidad: 'pct' },
      { label: 'Próximas 30 días (ventas / meta)', actual: ventas, anterior: meta, unidad: 'num' }
    ],
    insight: faltan > 0
      ? { texto: `Faltan ${faltan} ventas para llenar las ${ediciones} ediciones de los próximos 30 días.`, tono: null }
      : null,
    verTodo: null
  }
}

function riskRanking (enRiesgo) {
  const restantes = enRiesgo.length - RANKING_LIMIT
  return {
    tipo: 'ranking',
    titulo: '¿Qué ediciones pueden caerse?',
    pista: null,
    unidad: 'pct',
    items: enRiesgo.slice(0, RANKING_LIMIT).map(e => ({
      label: e.programa,
      sublabel: `inicia el ${dayMonth(e.fecha_inicio)}, ${e.ventas} de ${e.meta_ventas}`,
      valor: percentOf(e.ventas, e.meta_ventas),
      tono: TONE.BAD,
      ruta: null
    })),
    insight: restantes > 0
      ? { texto: `Hay ${restantes} ${restantes === 1 ? 'edición más' : 'ediciones más'} en riesgo.`, tono: TONE.BAD }
      : null,
    verTodo: { ruta: CRONOGRAMA, texto: 'Ver cronograma' }
  }
}

function upcomingDonut (proximas, { ediciones, sinMeta }) {
  const enBanda = (tono) => proximas.filter(e => fillBand(e) === tono).length
  return {
    tipo: 'dona',
    titulo: '¿Cómo vienen las ediciones de los próximos 30 días?',
    pista: 'Con meta de vacantes',
    unidad: 'num',
    total: ediciones,
    etiquetaTotal: 'ediciones',
    segmentos: [
      { label: 'Llenas (100% o más)', valor: enBanda(TONE.OK), tono: TONE.OK },
      { label: `A medio camino (${RISK_FILL * 100}% a 99%)`, valor: enBanda(TONE.WARN), tono: TONE.WARN },
      { label: `Bajo el ${RISK_FILL * 100}%`, valor: enBanda(TONE.BAD), tono: TONE.BAD }
    ],
    insight: sinMeta
      ? { texto: `${sinMeta} ${sinMeta === 1 ? 'edición no tiene' : 'ediciones no tienen'} meta cargada y no entran aquí.`, tono: TONE.WARN }
      : null,
    verTodo: null
  }
}

function cancellationWidget (cancelacion, { valor, referencia, ratio }) {
  return {
    tipo: 'grafico',
    titulo: '¿Cuántas ediciones se cancelan?',
    pista: 'A5 por mes de inicio',
    grafico: {
      tipo: 'barras',
      unidad: 'pct',
      categorias: cancelacion.map(f => monthLabel(f.mes)),
      series: [{ nombre: 'Cancelación A5', datos: cancelacion.map(cancellationPct), rol: 'principal' }],
      referencia: referencia === null ? null : { valor: referencia, etiqueta: 'promedio 6 meses' }
    },
    insight: valor !== null && referencia !== null
      ? { texto: `Este mes se cancela el ${valor}% contra ${referencia}% de promedio.`, tono: toneLowerIsBetter(ratio) }
      : null,
    verTodo: null
  }
}

function upcomingGauge ({ ediciones, ventas, meta, pct }) {
  return {
    tipo: 'medidor',
    titulo: '¿Cuánto de los próximos 30 días ya está vendido?',
    pista: `${ediciones} ediciones`,
    pct,
    etiqueta: 'de la meta',
    tono: null,
    leyenda: [
      { label: 'ventas', valor: ventas, tono: null },
      { label: 'vacantes', valor: meta, tono: null }
    ],
    insight: { texto: 'A 30 días del inicio lo normal es ir bajo; el juicio lo da el llenado a 14 días.', tono: null },
    verTodo: null
  }
}

function planningMetrics ({ sin_publicar: sinPublicar = 0, primera = null }, { sinMeta }) {
  const pendientes = Number(sinPublicar) || 0
  return {
    tipo: 'metricas',
    titulo: '¿Qué falta preparar?',
    pista: null,
    items: [
      { label: 'Ediciones del plan sin publicar', valor: pendientes, unidad: 'num', tono: pendientes ? TONE.WARN : TONE.OK, nota: 'inician en 90 días' },
      { label: 'Primera sin publicar', valor: primera ? dayMonth(primera) : null, unidad: 'texto', tono: null, nota: null },
      { label: 'Ediciones próximas sin meta', valor: sinMeta, unidad: 'num', tono: sinMeta ? TONE.WARN : TONE.OK, nota: 'sin meta no se mide su llenado' }
    ],
    insight: null,
    verTodo: { ruta: '/producto/planificacion', texto: 'Ver planificación' }
  }
}

function nextTwoWeeksTable (proximas) {
  const cercanas = proximas.filter(e => e.dias <= RISK_DAYS).sort((a, b) => a.dias - b.dias)
  return {
    tipo: 'tabla',
    titulo: '¿Cómo llegan las que inician en 14 días?',
    pista: 'Por fecha de inicio',
    columnas: [
      { key: 'edicion', label: 'Edición', unidad: 'texto' },
      { key: 'inicio', label: 'Inicio', unidad: 'texto' },
      { key: 'dias', label: 'Faltan (días)', unidad: 'num' },
      { key: 'ventas', label: 'Ventas', unidad: 'num' },
      { key: 'meta', label: 'Meta', unidad: 'num' },
      { key: 'llenado', label: 'Llenado', unidad: 'pct' }
    ],
    filas: cercanas.slice(0, TABLE_LIMIT).map(e => ({
      edicion: `${e.programa} (${e.codigo_edicion ?? e.edition_num_id})`,
      inicio: dayMonth(e.fecha_inicio),
      dias: e.dias,
      ventas: e.ventas,
      meta: e.meta_ventas || null,
      llenado: percentOf(e.ventas, e.meta_ventas),
      tono_llenado: fillBand(e)
    })),
    insight: cercanas.length > TABLE_LIMIT
      ? { texto: `Se muestran las ${TABLE_LIMIT} más próximas de ${cercanas.length}.`, tono: null }
      : null,
    verTodo: { ruta: CRONOGRAMA, texto: 'Ver todas' }
  }
}

const sum = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0)
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthLabel = (mes) => MONTHS_ES[mes.slice(5, 7)]
const dayMonth = (ymd) => `${String(ymd).slice(8, 10)}/${String(ymd).slice(5, 7)}`
