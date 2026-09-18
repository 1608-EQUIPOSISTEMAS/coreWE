import { TONE, TABLE_LIMIT, percentOf, toneLowerIsBetter, toneHigherIsBetter } from './results.entity.js'
import { widget, monthlyChart, row } from './area-widgets.entity.js'
import { evaluarReloj } from '../../../shared/sla/sla-clock.js'

// Los dos reportes de soporte del panel de lider, en el mismo contrato
// declarativo que los indicadores de area: TeamResults y ResultWidget ya saben
// pintar dona, tabla, medidor, metricas y grafico, asi que esto no toca Vue.
//
// Van al final del panel de las seis areas (los reemplazaron a "Correcciones de
// ventas"): un lider quiere ver como esta el soporte de SU gente, no el global.
//
// Reglas de lectura:
//   · Estado -> "¿que reporto mi area y en que quedo?"
//   · Tiempos -> "¿le responden a mi gente en el plazo prometido?"
// Ninguno juzga al area: juzga al soporte que recibe.

const TICKETS_ROUTE = { ruta: '/tickets', texto: 'Ver bandeja' }

// A partir de que proporcion de vencidos sobre el total el panel se pone serio.
// 10% es la misma TOLERANCE que usa el resto de los paneles.
const TOLERANCIA_VENCIDOS = 0.1

// El mismo panel sirve a tres alcances (lider de area, ADMIN viendo toda la
// empresa, colaborador viendo solo lo suyo); lo unico que cambia entre ellos
// es de quien se habla en el texto. AMBITO_AREA es el default: es el unico
// alcance que existia antes de esto, asi que su texto no cambia.
export const AMBITO_AREA = { creado: 'por tu área', posesivo: 'tu área', pronombre: 'tu área' }
export const AMBITO_GLOBAL = { creado: 'en toda la organización', posesivo: 'la organización', pronombre: 'la organización' }
export const AMBITO_PERSONAL = { creado: 'por ti', posesivo: 'lo que tú reportaste', pronombre: 'tus tickets' }

export function buildTicketRows (raw = {}, now = new Date(), ambito = AMBITO_AREA) {
  const abiertos = evaluarAbiertos(raw.abiertos ?? [], now)
  return [
    row('mitad', [statusDonut(raw.estado ?? {}, ambito), openTicketsTable(abiertos, ambito)]),
    row('tercios', [slaGauge(raw.tiempos ?? {}, ambito), timeMetrics(raw.tiempos ?? {}), responseTrend(raw.tendencia ?? [], now, ambito)])
  ].filter(Boolean)
}

// El estado del reloj se decide aqui y no en SQL: POR_VENCER depende del umbral
// de sla-clock y duplicarlo en la consulta lo desincronizaria.
export function evaluarAbiertos (filas, now) {
  return filas.map(t => {
    const respuesta = evaluarReloj(t.first_response_due_at, t.first_response_at, t.registration_date, now)
    const resolucion = evaluarReloj(t.resolution_due_at, t.resolved_at, t.registration_date, now)
    const estados = [respuesta.estado, resolucion.estado]
    return {
      ...t,
      vencido: estados.includes('VENCIDO'),
      porVencer: estados.includes('POR_VENCER')
    }
  })
}

// ── Reporte A: estado de los tickets ───────────────────────────────────────

export function statusDonut (estado, ambito = AMBITO_AREA) {
  const total = Number(estado.total ?? 0)
  if (!total) return null

  const abiertos = Number(estado.abiertos ?? 0)
  const enProgreso = Number(estado.en_progreso ?? 0)
  const vencidos = Number(estado.vencidos ?? 0)
  const pendientes = abiertos + enProgreso

  return widget('dona', `¿En qué quedó lo que reportó ${ambito.pronombre}?`, {
    pista: `Tickets creados ${ambito.creado} en los últimos 30 días`,
    unidad: 'num',
    total,
    etiquetaTotal: 'tickets · 30 días',
    segmentos: [
      { label: 'Cerrados', valor: Number(estado.cerrados ?? 0), tono: TONE.OK },
      { label: 'En progreso', valor: enProgreso, tono: 'principal' },
      { label: 'Sin tomar', valor: abiertos, tono: TONE.WARN }
    ],
    insight: {
      texto: pendientes === 0
        ? `Todo lo que reportó ${ambito.pronombre} este mes ya está cerrado.`
        : `${pendientes} sigue${pendientes === 1 ? '' : 'n'} sin cerrarse` +
          (vencidos ? `, ${vencidos} con el plazo vencido.` : '.'),
      // Se juzga por los VENCIDOS, no por los pendientes: tener tickets abiertos
      // es normal; tenerlos fuera de plazo es el problema. El ratio se mide
      // contra la tolerancia, asi que 1 = justo en el limite aceptable.
      tono: toneLowerIsBetter((vencidos / total) / TOLERANCIA_VENCIDOS)
    },
    verTodo: TICKETS_ROUTE
  })
}

export function openTicketsTable (abiertos = [], ambito = AMBITO_AREA) {
  if (!abiertos.length) return null

  // Vencidos primero, despues por vencer, despues los mas viejos: el orden en
  // que habria que atenderlos.
  const orden = [...abiertos].sort((a, b) =>
    (Number(b.vencido) - Number(a.vencido)) ||
    (Number(b.porVencer) - Number(a.porVencer)) ||
    (Number(b.dias ?? 0) - Number(a.dias ?? 0))
  )

  return widget('tabla', '¿Qué sigue sin resolverse?', {
    pista: `Lo que reportó ${ambito.pronombre} y todavía está abierto, por urgencia`,
    // unidad 'texto' no es decorativa: ResultWidget alinea a la derecha toda
    // columna que no la declare, y un asunto alineado a la derecha es ilegible.
    columnas: [
      { key: 'codigo', label: 'Ticket', unidad: 'texto' },
      { key: 'titulo', label: 'Asunto', unidad: 'texto' },
      { key: 'prioridad', label: 'Prioridad', unidad: 'texto' },
      { key: 'estado', label: 'Estado', unidad: 'texto' },
      { key: 'dias', label: 'Días abierto', unidad: 'num' },
      { key: 'sla', label: 'SLA', unidad: 'texto' }
    ],
    filas: orden.slice(0, TABLE_LIMIT).map(t => ({
      codigo: `#${String(t.ticket_id).padStart(5, '0')}`,
      titulo: t.title,
      prioridad: t.priority,
      estado: t.status === 'ABIERTO' ? 'Sin tomar' : 'En progreso',
      dias: Number(t.dias ?? 0),
      sla: t.vencido ? 'Vencido' : t.porVencer ? 'Por vencer' : 'En plazo',
      tono_prioridad: t.priority === 'ALTA' ? TONE.BAD : t.priority === 'MEDIA' ? TONE.WARN : null,
      tono_sla: t.vencido ? TONE.BAD : t.porVencer ? TONE.WARN : TONE.OK,
      ruta: '/tickets'
    })),
    insight: orden.length > TABLE_LIMIT
      ? { texto: `Hay ${orden.length} tickets abiertos; se muestran los ${TABLE_LIMIT} más urgentes.`, tono: null }
      : null,
    verTodo: TICKETS_ROUTE
  })
}

// ── Reporte B: tiempos de respuesta ────────────────────────────────────────

export function slaGauge (tiempos) {
  const aTiempo = Number(tiempos.resp_a_tiempo ?? 0) + Number(tiempos.res_a_tiempo ?? 0)
  const tarde = Number(tiempos.resp_tarde ?? 0) + Number(tiempos.res_tarde ?? 0)
  const conVeredicto = aTiempo + tarde

  // Sin plazos vencidos ni cumplidos no hay nada que medir: un medidor en 0 se
  // leeria como "nunca cumplen", que no es lo mismo que "todavia no hay datos".
  if (!conVeredicto) return null

  const pct = percentOf(aTiempo, conVeredicto)

  return widget('medidor', '¿Te responden en el plazo prometido?', {
    pista: 'Compromisos de SLA cumplidos en los últimos 90 días',
    pct,
    etiqueta: 'dentro del plazo',
    // La meta es 100%: un SLA no es un promedio a superar, es un compromiso.
    tono: toneHigherIsBetter(pct / 100),
    leyenda: [
      { label: 'Primera respuesta a tiempo', valor: Number(tiempos.resp_a_tiempo ?? 0), tono: TONE.OK },
      { label: 'Resueltos a tiempo', valor: Number(tiempos.res_a_tiempo ?? 0), tono: TONE.OK },
      { label: 'Fuera de plazo ahora', valor: Number(tiempos.vencidos_ahora ?? 0), tono: TONE.BAD }
    ]
    // Sin verTodo a proposito: ResultWidget muestra el enlace O la pista, y aca
    // importa mas decir que la cifra es de 90 dias que repetir el link a /tickets.
  })
}

export function timeMetrics (tiempos) {
  const resp = tiempos.mediana_resp_horas === null || tiempos.mediana_resp_horas === undefined
    ? null
    : Number(tiempos.mediana_resp_horas)
  const res = tiempos.mediana_res_horas === null || tiempos.mediana_res_horas === undefined
    ? null
    : Number(tiempos.mediana_res_horas)
  const escalados = Number(tiempos.escalados ?? 0)
  const sinTomar = Number(tiempos.sin_tomar ?? 0)

  if (resp === null && res === null && !escalados && !sinTomar) return null

  return widget('metricas', '¿Cuánto se tarda?', {
    pista: 'Mediana de los últimos 90 días, desde que se creó el ticket',
    items: [
      { label: 'Hasta la primera respuesta', valor: resp, unidad: 'horas', tono: null, nota: 'Mediana, no promedio: un caso extremo no mueve la cifra' },
      { label: 'Hasta el cierre', valor: res, unidad: 'horas', tono: null, nota: null },
      {
        label: 'Escalados solos',
        valor: escalados,
        unidad: 'num',
        tono: escalados ? TONE.WARN : null,
        nota: 'Reasignados automáticamente porque nadie los tomó a tiempo'
      },
      {
        label: 'Sin tomar ahora',
        valor: sinTomar,
        unidad: 'num',
        tono: sinTomar ? TONE.WARN : null,
        nota: null
      }
    ]
  })
}

// Tendencia de linea (no barras): lo que importa aqui es la trayectoria mes a
// mes, no comparar un mes contra otro como cifras aisladas. Mide el cierre, no
// la primera respuesta: es lo que un lider/ADMIN/colaborador siente como "me
// resolvieron esto", y el SLA de respuesta ya tiene su propio medidor arriba.
export function responseTrend (tendencia = [], now = new Date(), ambito = AMBITO_AREA) {
  const grafico = monthlyChart({
    serie: 'Horas hasta el cierre',
    unidad: 'horas',
    rows: tendencia,
    valorDelMes: r => (r.mediana_res_horas === null || r.mediana_res_horas === undefined
      ? null
      : Number(r.mediana_res_horas)),
    now,
    tipo: 'linea'
  })
  if (!grafico) return null

  return widget('grafico', '¿Mejora el tiempo de cierre?', {
    pista: `Mediana mensual de ${ambito.posesivo}, contra la de los 6 meses cerrados`,
    grafico
  })
}
