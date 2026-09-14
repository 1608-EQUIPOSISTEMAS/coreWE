import {
  TONE, RANKING_LIMIT, TABLE_LIMIT, median, ratioOf, percentOf, toneHigherIsBetter, toneLowerIsBetter,
  businessDays, goalProgress, formatSoles
} from './results.entity.js'
import { widget } from './area-widgets.entity.js'

// Indicadores de FICO: "¿se acumula la bandeja? ¿estamos cobrando?".
// Entrada: filas crudas de fetchFicoRaw. Salida: el contrato de results.entity.js.
export function buildFicoResults (raw, now = new Date()) {
  const dias = businessDays(now)
  const bandeja = raw.bandeja ?? {}
  const ingreso = raw.ingreso ?? {}
  const equipo = raw.equipo ?? []
  return {
    titular: headline(bandeja, ingreso),
    tarjetas: [
      backlogCard(bandeja),
      approvalsPaceCard(raw.ritmo),
      revenueCard(ingreso),
      delinquencyCard(raw.morosidad)
    ],
    filas: [
      {
        disposicion: 'hero',
        widgets: [revenueWidget(raw.ingresoDiario ?? [], ingreso, now), revenueComparison(ingreso, raw.aprobaciones, dias)]
      },
      { disposicion: 'mitad', widgets: [backlogWidget(bandeja), collectedDonut(raw.morosidad)] },
      {
        disposicion: 'tercios',
        widgets: [topTeam(equipo), backlogOnTimeGauge(bandeja), collectionMetrics(raw.porVencer, raw.tiempo, equipo, ingreso)]
      },
      { disposicion: 'completa', widgets: [oldestPendingTable(raw.pendientes ?? [])] }
    ]
  }
}

const BANDEJA_ROUTE = { ruta: '/fico/inscripciones', texto: 'Ver bandeja' }
const COBRANZAS_ROUTE = { ruta: '/fico/cobranzas', texto: 'Ver cobranzas' }

// Una venta con más de 3 días esperando ya tiene a un asesor y a un alumno
// preguntando: es el umbral de toda la sección de bandeja.
const LATE_DAYS = 3

const TONE_SEVERITY = [TONE.OK, TONE.WARN, TONE.BAD]

// El veredicto junta las dos preguntas de FICO (¿se acumula la bandeja?, ¿se
// cobra?) y toma el tono de la peor: un ingreso sano no tapa una bandeja atascada.
export function headline (bandeja = {}, ingreso = {}) {
  const ratio = ratioOf(ingreso.mes ?? 0, ingreso.prev_tramo)
  const tonos = [backlogTone(bandeja), toneHigherIsBetter(ratio)].filter(Boolean)
  return {
    texto: [backlogSentence(bandeja), revenueSentence(ratio)].filter(Boolean).join(' '),
    tono: tonos.length ? tonos.reduce((peor, t) => TONE_SEVERITY.indexOf(t) > TONE_SEVERITY.indexOf(peor) ? t : peor) : null
  }
}

function backlogSentence ({ total = 0, mayor_3: late = 0 }) {
  if (!total) return 'La bandeja está al día.'
  const ventas = total === 1 ? '1 venta espera validación' : `${total} ventas esperan validación`
  return late ? `${ventas} y ${late} llevan más de ${LATE_DAYS} días.` : `${ventas}, ninguna con más de ${LATE_DAYS} días.`
}

function revenueSentence (ratio) {
  if (ratio === null) return null
  const cambio = Math.round((ratio - 1) * 100)
  return `El ingreso va ${Math.abs(cambio)}% ${cambio >= 0 ? 'sobre' : 'bajo'} el mismo tramo del mes anterior.`
}

// Una bandeja sana solo guarda lo que entró hoy o ayer: pasados 3 días ya hay un
// asesor y un alumno esperando. Ámbar mientras ese atraso sea una parte chica de
// la cola; rojo cuando pesa.
const BACKLOG_LATE_SHARE_WARN = 0.2

export function backlogTone ({ total = 0, mayor_3: late = 0 }) {
  if (!late) return TONE.OK
  return late / total <= BACKLOG_LATE_SHARE_WARN ? TONE.WARN : TONE.BAD
}

// ── Tarjetas ─────────────────────────────────────────────────────────────

function backlogCard (bandeja) {
  return {
    label: 'Bandeja por validar',
    valor: bandeja.total ?? 0,
    unidad: 'num',
    ratio: null,
    tono: backlogTone(bandeja),
    icono: 'fa-inbox',
    comparativo: `${bandeja.mayor_3 ?? 0} con más de ${LATE_DAYS} días`
  }
}

function approvalsPaceCard ({ hoy = 0, muestras = [] } = {}) {
  const tipico = median(muestras)
  const ratio = ratioOf(hoy, tipico)
  return {
    label: 'Aprobadas hoy',
    valor: hoy,
    unidad: 'num',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-circle-check',
    comparativo: tipico === null ? 'sin histórico' : `típico a esta hora: ${round1(tipico)}`
  }
}

function revenueCard ({ mes = 0, prev_tramo: prevTramo = 0 }) {
  const ratio = ratioOf(mes, prevTramo)
  return {
    label: 'Ingreso del mes',
    valor: mes,
    unidad: 'soles',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-sack-dollar',
    comparativo: `mismo tramo del mes anterior: ${formatSoles(prevTramo)}`
  }
}

function delinquencyCard (morosidad = {}) {
  const { valor, referencia, ratio } = delinquency(morosidad)
  return {
    label: 'Morosidad 90 días',
    valor,
    unidad: 'pct',
    ratio,
    tono: toneLowerIsBetter(ratio),
    icono: 'fa-triangle-exclamation',
    comparativo: referencia === null ? 'sin datos hace un mes' : `hace un mes: ${referencia}%`
  }
}

function delinquency ({ actual = {}, prev = {} } = {}) {
  const valor = percentOf(actual.impago, actual.vencido)
  const referencia = percentOf(prev.impago, prev.vencido)
  return { valor, referencia, ratio: ratioOf(valor, referencia) }
}

// ── Fila principal ───────────────────────────────────────────────────────

// Curva acumulada día a día: dice si el mes se atrasa DESDE CUÁNDO, algo que un
// total del mes no muestra. Los días que no llegaron van en null (la línea se
// corta en hoy); el mes anterior, si es más corto, se queda en su total.
export function revenueChart (rows, now) {
  const dias = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const categorias = Array.from({ length: dias }, (_, i) => String(i + 1))
  const acumulado = (mes, hasta) => categorias.map((_, i) => (i + 1 > hasta
    ? null
    : rows.filter(r => r.mes === mes && r.dia <= i + 1).reduce((a, r) => a + Number(r.soles), 0)))
  return {
    tipo: 'linea',
    unidad: 'soles',
    categorias,
    series: [
      { nombre: 'Este mes', datos: acumulado('actual', now.getDate()), rol: 'principal' },
      { nombre: 'Mes anterior', datos: acumulado('prev', dias), rol: 'referencia' }
    ],
    referencia: null
  }
}

function revenueWidget (rows, ingreso, now) {
  const ratio = ratioOf(ingreso.mes ?? 0, ingreso.prev_tramo)
  return widget('grafico', '¿Cómo va el ingreso del mes?', {
    pista: 'Acumulado día a día contra el mes anterior',
    grafico: revenueChart(rows, now),
    insight: ratio === null ? null : { texto: revenueSentence(ratio), tono: toneHigherIsBetter(ratio) },
    verTodo: COBRANZAS_ROUTE
  })
}

function revenueComparison (ingreso, aprobaciones = {}, dias) {
  const mes = ingreso.mes ?? 0
  const prevTramo = ingreso.prev_tramo ?? 0
  const ratio = ratioOf(mes, prevTramo)
  const { proyeccion } = goalProgress({ logrado: mes, meta: null, ...dias })
  const mediana = median(ingreso.meses_previos ?? [])
  return widget('comparativo', 'Ingreso contra el mes anterior', {
    pista: 'Mismo tramo del mes anterior',
    valor: mes,
    unidad: 'soles',
    etiqueta: 'ingreso este mes',
    ratio,
    tono: toneHigherIsBetter(ratio),
    contra: `${formatSoles(prevTramo)} a esta fecha del mes anterior`,
    barras: [
      { label: 'Ingreso', actual: mes, anterior: prevTramo, unidad: 'soles' },
      { label: 'Aprobadas del mes', actual: aprobaciones.mes ?? 0, anterior: aprobaciones.prev_tramo ?? 0, unidad: 'num' }
    ],
    insight: {
      texto: mediana === null
        ? `Al ritmo actual el mes cierra en ${formatSoles(proyeccion)}.`
        : `Al ritmo actual el mes cierra en ${formatSoles(proyeccion)}; la mediana de 3 meses es ${formatSoles(mediana)}.`,
      tono: toneHigherIsBetter(ratioOf(proyeccion, mediana))
    }
  })
}

// ── Fila de bandeja y cobranza ───────────────────────────────────────────

function backlogWidget (bandeja) {
  return widget('grafico', '¿Cuánto espera la bandeja?', {
    pista: 'Ventas pendientes de validar, de toda la empresa',
    grafico: {
      tipo: 'barras-h',
      unidad: 'num',
      categorias: ['De hoy', 'De 1 a 3 días', `Más de ${LATE_DAYS} días`],
      series: [{
        nombre: 'Ventas por validar',
        datos: [bandeja.menor_24h ?? 0, bandeja.de_1_a_3 ?? 0, bandeja.mayor_3 ?? 0],
        rol: 'principal'
      }],
      referencia: null
    },
    insight: { texto: backlogSentence(bandeja), tono: backlogTone(bandeja) },
    verTodo: BANDEJA_ROUTE
  })
}

// Lo vencido en 90 días partido en cobrado y sin pagar: la morosidad en una
// sola imagen, con la comparación de hace un mes en el insight.
function collectedDonut (morosidad = {}) {
  const vencido = morosidad.actual?.vencido ?? 0
  const impago = morosidad.actual?.impago ?? 0
  const { valor, referencia, ratio } = delinquency(morosidad)
  return widget('dona', '¿Cuánto de lo vencido se cobró?', {
    pista: 'Cuotas vencidas en los últimos 90 días',
    unidad: 'soles',
    total: vencido,
    etiquetaTotal: 'vencido',
    segmentos: [
      { label: 'Cobrado', valor: vencido - impago, tono: TONE.OK },
      { label: 'Sin pagar', valor: impago, tono: TONE.BAD }
    ],
    insight: delinquencyInsight(vencido, valor, referencia, ratio),
    verTodo: COBRANZAS_ROUTE
  })
}

function delinquencyInsight (vencido, valor, referencia, ratio) {
  if (!vencido) return { texto: 'Sin cuotas vencidas en los últimos 90 días.', tono: null }
  const hace = referencia === null ? '' : `; hace un mes era ${referencia}%`
  return { texto: `Morosidad de ${valor}%${hace}.`, tono: toneLowerIsBetter(ratio) }
}

// ── Fila de tercios ──────────────────────────────────────────────────────

function topTeam (equipo) {
  const items = equipo
    .filter(p => p.aprobadas_mes > 0)
    .sort((x, y) => y.aprobadas_mes - x.aprobadas_mes)
    .slice(0, RANKING_LIMIT)
    .map(p => ({
      label: `${p.alias} ${p.name}`,
      sublabel: p.horas === null || p.horas === undefined
        ? `${p.observadas_mes} observadas`
        : `${round1(p.horas)} h de mediana, ${p.observadas_mes} observadas`,
      valor: p.aprobadas_mes,
      tono: null,
      ruta: null
    }))
  return widget('ranking', `Top ${RANKING_LIMIT} del equipo FICO`, {
    pista: 'Aprobadas del mes',
    unidad: 'num',
    items,
    insight: items.length ? null : { texto: 'Todavía no hay aprobaciones este mes.', tono: null }
  })
}

// "Aprobadas a tiempo" pediría el tiempo de cada venta ya validada; lo honesto
// con lo que hay es la foto de hoy: qué parte de la bandeja todavía no se atrasó.
function backlogOnTimeGauge (bandeja) {
  const total = bandeja.total ?? 0
  const atrasadas = bandeja.mayor_3 ?? 0
  return widget('medidor', '¿Qué parte de la bandeja está al día?', {
    pista: `Pendientes con ${LATE_DAYS} días o menos`,
    pct: percentOf(total - atrasadas, total),
    etiqueta: 'al día',
    tono: total ? backlogTone(bandeja) : null,
    leyenda: [
      { label: 'Al día', valor: total - atrasadas, tono: TONE.OK },
      { label: `Más de ${LATE_DAYS} días`, valor: atrasadas, tono: TONE.BAD }
    ],
    insight: atrasadas
      ? { texto: `Priorizar las ${atrasadas} ventas con más de ${LATE_DAYS} días.`, tono: backlogTone(bandeja) }
      : { texto: total ? 'Ninguna venta está atrasada.' : 'La bandeja está vacía.', tono: TONE.OK }
  })
}

function collectionMetrics (porVencer = {}, tiempo = {}, equipo, ingreso) {
  const horasMes = tiempo.horas_mes ?? null
  const horasPrev = tiempo.horas_prev ?? null
  const mediana = median(ingreso.meses_previos ?? [])
  return widget('metricas', 'Cobranza y validación', {
    items: [
      {
        label: 'Por vencer esta semana',
        valor: porVencer.monto ?? 0,
        unidad: 'soles',
        tono: null,
        nota: `${porVencer.cuotas ?? 0} cuotas en los próximos 7 días`
      },
      {
        label: 'Tiempo de aprobación',
        valor: horasMes === null ? null : round1(horasMes),
        unidad: 'horas',
        tono: toneLowerIsBetter(ratioOf(horasMes, horasPrev)),
        nota: horasPrev === null ? 'sin datos del mes anterior' : `mes anterior: ${round1(horasPrev)} h`
      },
      {
        label: 'Observadas del mes',
        valor: equipo.reduce((a, p) => a + Number(p.observadas_mes ?? 0), 0),
        unidad: 'num',
        tono: null,
        nota: null
      },
      {
        label: 'Ingreso mediano de 3 meses',
        valor: mediana,
        unidad: 'soles',
        tono: null,
        nota: null
      }
    ]
  })
}

// ── Tabla de trabajo ─────────────────────────────────────────────────────

function oldestPendingTable (pendientes) {
  return widget('tabla', 'Ventas que más esperan', {
    pista: `Las ${TABLE_LIMIT} pendientes de validar más antiguas`,
    columnas: [
      { key: 'alumno', label: 'Alumno', unidad: 'texto' },
      { key: 'programa', label: 'Programa', unidad: 'texto' },
      { key: 'asesor', label: 'Asesor', unidad: 'texto' },
      { key: 'dias', label: 'Días esperando', unidad: 'num' }
    ],
    filas: pendientes.slice(0, TABLE_LIMIT).map(p => ({
      alumno: p.alumno || `Venta ${p.enrollment_id}`,
      programa: p.programa,
      asesor: p.asesor,
      dias: p.dias,
      tono_dias: p.dias > LATE_DAYS ? TONE.BAD : null,
      ruta: `/fico/inscripciones/${p.enrollment_id}`
    })),
    insight: pendientes.length ? null : { texto: 'No hay ventas esperando validación.', tono: TONE.OK },
    verTodo: BANDEJA_ROUTE
  })
}

const round1 = (n) => Math.round(n * 10) / 10
