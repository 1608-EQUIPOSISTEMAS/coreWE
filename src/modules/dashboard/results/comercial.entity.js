import {
  TONE, RANKING_LIMIT, TABLE_LIMIT, median, ratioOf, percentOf, toneHigherIsBetter, toneLowerIsBetter,
  businessDays, goalProgress
} from './results.entity.js'
import { widget, differenceText } from './area-widgets.entity.js'

// Indicadores de Comercial: "¿llegamos a la meta, quién va atrasado hoy y a
// quién no se le da seguimiento?".
// Entrada: filas crudas de fetchComercialRaw. Salida: el contrato de results.entity.js.
export function buildComercialResults (
  { ritmo, asesores = [], conversionHistorica = [], ritmoPorHora = [], seguimiento = [] },
  now = new Date()
) {
  const dias = businessDays(now)
  const seg = followUpByAdvisor(seguimiento)
  const conSeguimiento = asesores.map(a => ({ ...a, ...emptyFollowUp(), ...seg.porAsesor.get(a.user_id) }))
  const equipo = sumTeam(conSeguimiento)
  return {
    titular: headline(ritmo, equipo, dias),
    tarjetas: [
      todayPaceCard(ritmo),
      monthCard(equipo, dias),
      followUpCard(seg.equipo, seg.equipoPrev),
      unattendedCard(equipo)
    ],
    filas: [
      { disposicion: 'hero', widgets: [todayPaceWidget(ritmoPorHora, ritmo), monthComparison(equipo, seg, dias)] },
      { disposicion: 'mitad', widgets: [followUpWidget(conSeguimiento, seg.equipo), attentionDonut(seg.equipo, seg.equipoPrev)] },
      {
        disposicion: 'tercios',
        widgets: [topAdvisors(conSeguimiento, dias), conversionGauge(equipo, conversionHistorica), qualityMetrics(equipo, seg)]
      },
      { disposicion: 'completa', widgets: [advisorsTable(conSeguimiento, dias, seg.equipo)] }
    ]
  }
}

const LEADS_ROUTE = { ruta: '/comercial/leads', texto: 'Ver consultas' }

const SUMMED_FIELDS = ['hoy', 'mes', 'mes_prev', 'mes_prev_tramo', 'observadas', 'observadas_prev', 'meta', 'consultas', 'pagadas', 'sin_gestion']

function sumTeam (asesores) {
  return Object.fromEntries(SUMMED_FIELDS.map(f => [f, asesores.reduce((a, r) => a + Number(r[f] ?? 0), 0)]))
}

// ── Veredicto ────────────────────────────────────────────────────────────
//
// Dos frases: cómo va HOY y cómo cierra el MES. El tono lo pone el mes, que es
// lo que se cumple o no; el día solo da el tono si el mes no tiene contra qué medirse.
export function headline (ritmo = {}, equipo, dias) {
  // Sin ventas en el mes, "hoy no hay ventas" repetiría lo mismo dos veces.
  const hoy = equipo.mes ? todaySentence(ritmo) : { texto: null, tono: null }
  const mes = monthSentence(equipo, dias)
  const texto = [hoy.texto, mes.texto].filter(Boolean).join(' ')
  if (!texto) return { texto: 'Todavía no hay ventas registradas este mes.', tono: null }
  return { texto, tono: mes.tono ?? hoy.tono }
}

function todaySentence ({ hoy = 0, muestras = [] } = {}) {
  const ratio = ratioOf(hoy, median(muestras))
  if (!hoy) return { texto: 'Hoy todavía no hay ventas.', tono: toneHigherIsBetter(ratio) }
  const van = `Van ${hoy} ${plural(hoy, 'venta', 'ventas')} hoy`
  return {
    texto: ratio === null ? `${van}.` : `${van}, ${differenceText(ratio)} lo típico a esta hora.`,
    tono: toneHigherIsBetter(ratio)
  }
}

function monthSentence (equipo, dias) {
  const avance = goalProgress({ logrado: equipo.mes, meta: equipo.meta, ...dias })
  if (equipo.meta) {
    return {
      texto: `Al ritmo actual cierran el mes en ${Math.round((avance.proyeccion / equipo.meta) * 100)}% de la meta.`,
      tono: avance.tono
    }
  }
  const ratio = ratioOf(equipo.mes, equipo.mes_prev_tramo)
  if (ratio === null) return { texto: null, tono: null }
  // "100% bajo" es exacto pero no se entiende; con cero se dice con palabras.
  if (!equipo.mes) {
    return {
      texto: `En el mes todavía no hay ventas; a esta fecha del mes anterior iban ${equipo.mes_prev_tramo}.`,
      tono: toneHigherIsBetter(ratio)
    }
  }
  return {
    texto: `En el mes van ${equipo.mes}, ${differenceText(ratio)} el mismo tramo del mes anterior (${equipo.mes_prev_tramo}).`,
    tono: toneHigherIsBetter(ratio)
  }
}

// ── Tarjetas ─────────────────────────────────────────────────────────────

function todayPaceCard ({ hoy = 0, muestras = [] } = {}) {
  const tipico = median(muestras)
  const ratio = ratioOf(hoy, tipico)
  return {
    label: 'Enviadas a FICO hoy',
    valor: hoy,
    unidad: 'num',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-paper-plane',
    comparativo: tipico === null ? 'sin histórico' : `típico a esta hora: ${round1(tipico)}`
  }
}

// Con meta, se juzga contra lo que ya debería llevarse a la fecha; sin meta,
// contra el mismo tramo del mes anterior (el 0 de una meta no cargada no es incumplimiento).
function monthCard (equipo, dias) {
  const avance = goalProgress({ logrado: equipo.mes, meta: equipo.meta, ...dias })
  const base = { label: 'Ventas del mes', valor: equipo.mes, unidad: 'num', icono: 'fa-chart-line' }
  if (!equipo.meta) {
    const ratio = ratioOf(equipo.mes, equipo.mes_prev_tramo)
    return { ...base, ratio, tono: toneHigherIsBetter(ratio), comparativo: `mismo tramo del mes anterior: ${equipo.mes_prev_tramo}` }
  }
  return {
    ...base,
    ratio: ratioOf(avance.pct, avance.esperado),
    tono: avance.tono,
    comparativo: `meta ${equipo.meta}, proyección al cierre ${avance.proyeccion}`
  }
}

function followUpCard (equipo, prev) {
  const valor = percentOf(equipo.con_seguimiento, equipo.consultas)
  const referencia = percentOf(prev.con_seguimiento, prev.consultas)
  const ratio = ratioOf(valor, referencia)
  return {
    label: 'Consultas con seguimiento',
    valor,
    unidad: 'pct',
    ratio,
    tono: toneHigherIsBetter(ratio),
    icono: 'fa-headset',
    comparativo: referencia === null ? 'sin consultas los 30 días anteriores' : `30 días antes: ${referencia}%`
  }
}

function unattendedCard (equipo) {
  return {
    label: 'Consultas sin gestión',
    valor: equipo.sin_gestion,
    unidad: 'num',
    ratio: null,
    tono: equipo.sin_gestion ? TONE.WARN : TONE.OK,
    icono: 'fa-user-clock',
    comparativo: 'últimos 30 días, sin ningún contacto'
  }
}

// ── Fila principal ───────────────────────────────────────────────────────

// La línea de hoy contra la típica muestra A QUÉ HORA el día se despegó o se
// quedó, algo que el número de "enviadas hoy" solo no cuenta.
function todayPaceWidget (ritmoPorHora, ritmo) {
  return widget('grafico', '¿Vamos bien hoy?', {
    pista: 'Acumulado por hora contra la mediana de 20 días hábiles',
    grafico: {
      tipo: 'linea',
      unidad: 'num',
      categorias: ritmoPorHora.map(r => `${r.hora} h`),
      series: [
        { nombre: 'Hoy', datos: ritmoPorHora.map(r => r.hoy ?? null), rol: 'principal' },
        { nombre: 'Típico a esta hora', datos: ritmoPorHora.map(r => round1(r.tipico ?? 0)), rol: 'referencia' }
      ],
      referencia: null
    },
    insight: todaySentence(ritmo)
  })
}

// Consultas y seguimiento se comparan en ventanas de 30 días (no por mes
// calendario): así el día 2 del mes no muestra un embudo vacío.
function monthComparison (equipo, seg, dias) {
  const ratio = ratioOf(equipo.mes, equipo.mes_prev_tramo)
  return widget('comparativo', 'Mes contra el anterior', {
    pista: 'Mismo tramo del mes anterior',
    valor: equipo.mes,
    unidad: 'num',
    etiqueta: 'ventas este mes',
    ratio,
    tono: toneHigherIsBetter(ratio),
    contra: `${equipo.mes_prev_tramo} a esta fecha del mes anterior`,
    barras: [
      { label: 'Ventas', actual: equipo.mes, anterior: equipo.mes_prev_tramo, unidad: 'num' },
      { label: 'Consultas (30 días)', actual: seg.equipo.consultas, anterior: seg.equipoPrev.consultas, unidad: 'num' },
      { label: 'Con seguimiento (30 días)', actual: seg.equipo.con_seguimiento, anterior: seg.equipoPrev.con_seguimiento, unidad: 'num' }
    ],
    insight: projectionInsight(equipo, dias)
  })
}

function projectionInsight (equipo, dias) {
  const avance = goalProgress({ logrado: equipo.mes, meta: equipo.meta, ...dias })
  if (!equipo.meta) {
    return { texto: `Al ritmo actual cierran el mes con ${avance.proyeccion} ventas. No hay meta cargada.`, tono: null }
  }
  return {
    texto: `Al ritmo actual cierran con ${avance.proyeccion} ventas, ${Math.round((avance.proyeccion / equipo.meta) * 100)}% de la meta de ${equipo.meta}.`,
    tono: avance.tono
  }
}

// ── Seguimiento a clientes ───────────────────────────────────────────────
//
// Las filas vienen de un GROUPING SETS: por asesor (user_id) y del equipo
// (user_id null), cada una para los últimos 30 días (reciente) y los 30 anteriores.
function followUpByAdvisor (rows) {
  const porAsesor = new Map()
  let equipo = emptyTeamFollowUp()
  let equipoPrev = emptyTeamFollowUp()
  for (const r of rows) {
    if (r.user_id === null || r.user_id === undefined) {
      if (r.reciente) equipo = r
      else equipoPrev = r
    } else if (r.reciente) {
      porAsesor.set(r.user_id, {
        consultas_30d: r.consultas,
        con_seguimiento: r.con_seguimiento,
        en_24h: r.en_24h,
        horas_primer_contacto: r.horas_primer_contacto
      })
    }
  }
  return { porAsesor, equipo, equipoPrev }
}

const emptyFollowUp = () => ({ consultas_30d: 0, con_seguimiento: 0, en_24h: 0, horas_primer_contacto: null })
const emptyTeamFollowUp = () => ({ consultas: 0, con_seguimiento: 0, en_24h: 0, horas_primer_contacto: null })

// Solo asesores con consultas en la ventana: sin consultas no hay a quién seguir,
// y una barra en 0 acusaría a quien no recibió leads.
function followUpWidget (asesores, equipo) {
  const filas = asesores
    .filter(a => a.consultas_30d > 0)
    .map(a => ({ alias: a.alias, pct: percentOf(a.con_seguimiento, a.consultas_30d) }))
    .sort((x, y) => y.pct - x.pct)
  const promedio = percentOf(equipo.con_seguimiento, equipo.consultas)
  return widget('grafico', '¿Quién le da seguimiento a sus consultas?', {
    pista: 'Consultas de los últimos 30 días con al menos un contacto',
    grafico: {
      tipo: 'barras-h',
      unidad: 'pct',
      categorias: filas.map(f => f.alias),
      series: [{ nombre: 'Consultas con seguimiento', datos: filas.map(f => f.pct), rol: 'principal' }],
      referencia: promedio === null ? null : { valor: promedio, etiqueta: 'promedio del equipo' }
    },
    insight: lowestFollowUpInsight(filas, promedio),
    verTodo: LEADS_ROUTE
  })
}

// Señala a quien más se aleja del equipo: es a quien el líder tiene que llamar.
function lowestFollowUpInsight (filas, promedio) {
  if (!filas.length) return { texto: 'Sin consultas en los últimos 30 días.', tono: null }
  if (filas.length < 2 || promedio === null) return null
  const ultimo = filas[filas.length - 1]
  // Si nadie queda bajo el promedio (p.ej. todos en 0%) no hay a quién señalar.
  if (ultimo.pct >= promedio) return null
  return {
    texto: `${ultimo.alias} es quien menos seguimiento da: ${ultimo.pct}% contra ${promedio}% del equipo.`,
    tono: toneHigherIsBetter(ratioOf(ultimo.pct, promedio))
  }
}

// Llegar primero decide la venta: una consulta atendida al día siguiente ya
// habló con otra institución. Por eso la dona separa "en 24 h" de "después".
function attentionDonut (equipo, prev) {
  const despues = equipo.con_seguimiento - equipo.en_24h
  const sinContacto = equipo.consultas - equipo.con_seguimiento
  return widget('dona', '¿Cómo se atienden las consultas?', {
    pista: 'Últimos 30 días',
    unidad: 'num',
    total: equipo.consultas,
    etiquetaTotal: 'consultas',
    segmentos: [
      { label: 'En 24 h', valor: equipo.en_24h, tono: TONE.OK },
      { label: 'Después de 24 h', valor: despues, tono: TONE.WARN },
      { label: 'Sin contacto', valor: sinContacto, tono: TONE.BAD }
    ],
    insight: firstContactInsight(equipo, prev)
  })
}

function firstContactInsight (equipo, prev) {
  if (equipo.horas_primer_contacto === null) return null
  const ratio = ratioOf(percentOf(equipo.en_24h, equipo.consultas), percentOf(prev.en_24h, prev.consultas))
  return {
    texto: `El primer contacto llega a las ${round1(equipo.horas_primer_contacto)} h (mediana).`,
    tono: toneHigherIsBetter(ratio)
  }
}

// ── Fila de tercios ──────────────────────────────────────────────────────

function topAdvisors (asesores, dias) {
  const items = asesores
    .filter(a => a.mes > 0)
    .sort((x, y) => y.mes - x.mes)
    .slice(0, RANKING_LIMIT)
    .map(a => {
      const avance = goalProgress({ logrado: a.mes, meta: a.meta, ...dias })
      return {
        label: `${a.alias} ${a.name}`,
        sublabel: a.meta ? `${avance.pct}% de la meta de ${a.meta}` : 'sin meta cargada',
        valor: a.mes,
        tono: avance.tono,
        ruta: null
      }
    })
  return widget('ranking', `Top ${RANKING_LIMIT} asesores del mes`, {
    pista: 'Ventas del mes',
    unidad: 'num',
    items,
    insight: items.length ? null : { texto: 'Todavía no hay ventas este mes.', tono: null }
  })
}

// La conversión del mes contra la mediana de los 3 anteriores: un mes flojo no
// se confunde con una caída sostenida.
function conversionGauge (equipo, conversionHistorica) {
  const pct = percentOf(equipo.pagadas, equipo.consultas)
  const referencia = median(conversionHistorica.map(m => percentOf(m.pagadas, m.consultas)))
  const tono = toneHigherIsBetter(ratioOf(pct, referencia))
  return widget('medidor', 'Conversión consulta → venta', {
    pista: 'Mes en curso',
    pct,
    etiqueta: 'conversión',
    tono,
    leyenda: [
      { label: 'Ventas por fecha de pago', valor: equipo.pagadas, tono: null },
      { label: 'Consultas del mes', valor: equipo.consultas, tono: null }
    ],
    insight: referencia === null ? null : { texto: `Mediana de los 3 meses anteriores: ${round1(referencia)}%.`, tono }
  })
}

function qualityMetrics (equipo, seg) {
  const observadas = percentOf(equipo.observadas, equipo.mes)
  const observadasPrev = percentOf(equipo.observadas_prev, equipo.mes_prev)
  const en24h = percentOf(seg.equipo.en_24h, seg.equipo.consultas)
  const en24hPrev = percentOf(seg.equipoPrev.en_24h, seg.equipoPrev.consultas)
  return widget('metricas', 'Calidad del envío', {
    items: [
      {
        label: 'Observadas por FICO',
        valor: observadas,
        unidad: 'pct',
        tono: toneLowerIsBetter(ratioOf(observadas, observadasPrev)),
        nota: observadasPrev === null ? null : `mes anterior: ${observadasPrev}%`
      },
      {
        label: 'Atendidas en 24 h',
        valor: en24h,
        unidad: 'pct',
        tono: toneHigherIsBetter(ratioOf(en24h, en24hPrev)),
        nota: en24hPrev === null ? null : `30 días antes: ${en24hPrev}%`
      },
      {
        label: 'Primer contacto (mediana)',
        valor: seg.equipo.horas_primer_contacto === null ? null : round1(seg.equipo.horas_primer_contacto),
        unidad: 'horas',
        tono: null,
        nota: null
      },
      {
        label: 'Consultas sin gestión',
        valor: equipo.sin_gestion,
        unidad: 'num',
        tono: equipo.sin_gestion ? TONE.WARN : TONE.OK,
        nota: 'últimos 30 días'
      }
    ]
  })
}

// ── Tabla de asesores ────────────────────────────────────────────────────

function advisorsTable (asesores, dias, equipoSeguimiento) {
  const promedio = {
    seguimiento: percentOf(equipoSeguimiento.con_seguimiento, equipoSeguimiento.consultas),
    en_24h: percentOf(equipoSeguimiento.en_24h, equipoSeguimiento.consultas)
  }
  const filas = asesores
    .filter(a => a.mes || a.hoy || a.meta || a.consultas || a.sin_gestion || a.consultas_30d)
    .map(a => advisorRow(a, dias, promedio))
    .sort((x, y) => y.mes - x.mes)
    .slice(0, TABLE_LIMIT)
  return widget('tabla', 'Asesores', {
    pista: 'Avance contra los días hábiles transcurridos; seguimiento y 24 h contra el promedio del equipo',
    columnas: [
      { key: 'asesor', label: 'Asesor', unidad: 'texto' },
      { key: 'hoy', label: 'Hoy', unidad: 'num' },
      { key: 'mes', label: 'Mes', unidad: 'num' },
      { key: 'meta', label: 'Meta', unidad: 'num' },
      { key: 'avance', label: 'Avance', unidad: 'pct' },
      { key: 'proyeccion', label: 'Proyección', unidad: 'num' },
      { key: 'seguimiento', label: 'Seguimiento', unidad: 'pct' },
      { key: 'en_24h', label: 'En 24 h', unidad: 'pct' },
      { key: 'observadas', label: 'Observadas', unidad: 'num' },
      { key: 'conversion', label: 'Conversión', unidad: 'pct' },
      { key: 'sin_gestion', label: 'Sin gestión', unidad: 'num' }
    ],
    filas,
    verTodo: LEADS_ROUTE
  })
}

function advisorRow (a, dias, promedio) {
  const avance = goalProgress({ logrado: a.mes, meta: a.meta, ...dias })
  const seguimiento = percentOf(a.con_seguimiento, a.consultas_30d)
  const en24h = percentOf(a.en_24h, a.consultas_30d)
  return {
    asesor: `${a.alias} ${a.name}`,
    hoy: a.hoy,
    mes: a.mes,
    meta: a.meta,
    avance: avance.pct,
    tono_avance: avance.tono,
    proyeccion: avance.proyeccion,
    seguimiento,
    tono_seguimiento: toneHigherIsBetter(ratioOf(seguimiento, promedio.seguimiento)),
    en_24h: en24h,
    tono_en_24h: toneHigherIsBetter(ratioOf(en24h, promedio.en_24h)),
    observadas: a.observadas,
    conversion: percentOf(a.pagadas, a.consultas),
    sin_gestion: a.sin_gestion,
    ruta: null
  }
}

const plural = (n, uno, varios) => (n === 1 ? uno : varios)
const round1 = (n) => Math.round(n * 10) / 10
