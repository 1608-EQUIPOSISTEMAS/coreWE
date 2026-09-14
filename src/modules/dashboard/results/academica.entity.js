import { TONE, ratioOf, percentOf, toneHigherIsBetter, RANKING_LIMIT, TABLE_LIMIT } from './results.entity.js'

// Académica responde "¿se dictan y registran las clases? ¿salen con nota y certificado?".

// Aula chica: por debajo de este AULA el salón pierde dinámica de grupo.
// ponytail: umbral propuesto, sin regla escrita en el negocio; ajustarlo con Académica.
export const SMALL_CLASSROOM = 8

const DICTADA = new Set(['A', 'T'])
const classroomRoute = (editionId) => `/academica/aulas/${editionId}`

export function buildAcademicaResults ({ aulasSemana = [], aulasFinalizadas = [], aulaMetricas = [], seguimiento = {} }, now = new Date()) {
  const hoy = ymd(now)
  const sesiones = sessionCompliance(seguimiento, hoy)
  const semana = classroomsThisWeek(aulasSemana, aulaMetricas)
  const cierre = closureOf(aulasFinalizadas)

  return {
    titular: headline(sesiones),
    tarjetas: [classroomsCard(semana), sessionsCard(sesiones), gradesCard(cierre), certificatesCard(cierre)],
    filas: [
      { disposicion: 'hero', widgets: [weeklySessionsWidget(seguimiento, hoy), sessionsGauge(sesiones)] },
      { disposicion: 'mitad', widgets: [teachersRanking(sesiones.docentes), weekMomentDonut(semana)] },
      { disposicion: 'tercios', widgets: [gradesGauge(cierre), certificatesGauge(cierre), smallClassroomsRanking(semana)] },
      { disposicion: 'completa', widgets: [ungradedTable(aulasFinalizadas, hoy)] }
    ]
  }
}

function headline ({ debidas, registradas, docentes }) {
  if (!debidas) return { texto: 'No hubo sesiones por dictar en los últimos 30 días.', tono: null }
  const pendientes = docentes.length === 0
    ? ''
    : ` ${docentes.length} ${docentes.length === 1 ? 'docente tiene' : 'docentes tienen'} clases sin registrar.`
  return {
    texto: `El ${percentOf(registradas, debidas)}% de las sesiones de los últimos 30 días está registrado.${pendientes}`,
    tono: toneHigherIsBetter(ratioOf(registradas, debidas))
  }
}

// ── Reglas ──────────────────────────────────────────────────────────────

// Sesiones que ya tocaban (fecha efectiva anterior a hoy, dentro de la ventana
// del seguimiento). La fecha efectiva ya trae la cascada de reprogramaciones:
// una R movida al futuro todavía no se debe. Es la única definición de "debida":
// el medidor, el ranking de docentes y el gráfico semanal leen de aquí.
function dueSessions ({ date_start: desde = '', editions = [] } = {}, hoy) {
  return editions.flatMap(aula => (aula.sessions ?? [])
    .filter(s => s.date < hoy && s.date >= desde)
    .map(s => ({ aula, sesion: s, registrada: DICTADA.has(s.status) })))
}

export function sessionCompliance (seguimiento, hoy) {
  const debidas = dueSessions(seguimiento, hoy)
  const porDocente = new Map()

  for (const { aula, sesion, registrada } of debidas) {
    if (registrada) continue
    const nombre = aula.instructor || 'Sin docente'
    const d = porDocente.get(nombre) ?? { docente: nombre, aulas: new Set(), pendientes: 0, mas_antigua: sesion.date }
    d.aulas.add(aula.edition_num_id)
    d.pendientes++
    if (sesion.date < d.mas_antigua) d.mas_antigua = sesion.date
    porDocente.set(nombre, d)
  }

  const docentes = [...porDocente.values()]
    .map(d => ({ ...d, aulas: d.aulas.size, mas_antigua: dayMonth(d.mas_antigua) }))
    .sort((a, b) => b.pendientes - a.pendientes)
  return { debidas: debidas.length, registradas: debidas.filter(d => d.registrada).length, docentes }
}

// Aulas de la semana con su AULA real; un aula sin roster en las métricas tiene 0 alumnos.
function classroomsThisWeek (aulasSemana, aulaMetricas) {
  const alumnosPorAula = new Map(aulaMetricas.map(m => [Number(m.edition_num_id), Number(m.cnt_aula) || 0]))
  const actual = aulasSemana
    .filter(a => a.semana === 'actual')
    .map(a => ({ ...a, alumnos: alumnosPorAula.get(Number(a.edition_num_id)) ?? 0 }))
  return { actual, hace4: aulasSemana.filter(a => a.semana === 'hace_4').length }
}

function closureOf (aulasFinalizadas) {
  const sum = (key) => aulasFinalizadas.reduce((a, r) => a + (Number(r[key]) || 0), 0)
  return {
    total: aulasFinalizadas.length,
    conNota: aulasFinalizadas.filter(a => a.con_nota > 0).length,
    aprobados: sum('aprobados'),
    emitidos: sum('certificados')
  }
}

// ── Tarjetas ────────────────────────────────────────────────────────────
// Las metas de Académica son el 100% (todo registrado, todo con nota): la
// tarjeta muestra el tono, no una "variación" contra 100 que se leería rara.

// Cuántas aulas dictan no es bueno ni malo: contraste sin semáforo.
function classroomsCard ({ actual, hace4 }) {
  return {
    label: 'Aulas en curso esta semana',
    valor: actual.length,
    unidad: 'num',
    ratio: ratioOf(actual.length, hace4),
    tono: null,
    icono: 'fa-chalkboard-user',
    comparativo: `hace 4 semanas: ${hace4}`
  }
}

function sessionsCard ({ debidas, registradas }) {
  return {
    label: 'Sesiones registradas',
    valor: percentOf(registradas, debidas),
    unidad: 'pct',
    ratio: null,
    tono: toneHigherIsBetter(ratioOf(registradas, debidas)),
    icono: 'fa-clipboard-check',
    comparativo: `${registradas} de ${debidas} sesiones en 30 días`
  }
}

function gradesCard ({ total, conNota }) {
  return {
    label: 'Aulas con notas cargadas',
    valor: percentOf(conNota, total),
    unidad: 'pct',
    ratio: null,
    tono: toneHigherIsBetter(ratioOf(conNota, total)),
    icono: 'fa-file-signature',
    comparativo: `${conNota} de ${total} finalizadas en 60 días`
  }
}

function certificatesCard ({ aprobados, emitidos }) {
  return {
    label: 'Certificados pendientes',
    valor: aprobados - emitidos,
    unidad: 'num',
    ratio: null,
    tono: toneHigherIsBetter(ratioOf(emitidos, aprobados)),
    icono: 'fa-award',
    comparativo: `${emitidos} de ${aprobados} aprobados certificados`
  }
}

// ── Widgets ─────────────────────────────────────────────────────────────

// Semana a semana deja ver si el registro atrasado es de hace un mes (se olvidó)
// o de esta semana (todavía se puede pedir).
function weeklySessionsWidget (seguimiento, hoy) {
  const semanas = new Map()
  for (const { sesion, registrada } of dueSessions(seguimiento, hoy)) {
    const lunes = mondayOf(sesion.date)
    const s = semanas.get(lunes) ?? { registradas: 0, sinRegistrar: 0 }
    if (registrada) s.registradas++
    else s.sinRegistrar++
    semanas.set(lunes, s)
  }
  const orden = [...semanas.keys()].sort()
  const peor = orden.reduce((max, l) => (semanas.get(l).sinRegistrar > (semanas.get(max)?.sinRegistrar ?? 0) ? l : max), null)

  return {
    tipo: 'grafico',
    titulo: '¿Se están registrando las clases?',
    pista: 'Últimos 30 días',
    grafico: {
      tipo: 'barras',
      unidad: 'num',
      categorias: orden.map(lunes => `Sem. ${dayMonth(lunes)}`),
      series: [
        { nombre: 'Registradas', datos: orden.map(l => semanas.get(l).registradas), rol: 'principal' },
        { nombre: 'Sin registrar', datos: orden.map(l => semanas.get(l).sinRegistrar), rol: 'referencia' }
      ],
      referencia: null
    },
    insight: weeklyInsight(orden, peor && semanas.get(peor), peor),
    verTodo: { ruta: '/academica/semanal', texto: 'Vista semanal' }
  }
}

function weeklyInsight (orden, peorSemana, lunes) {
  if (!orden.length) return null
  if (!peorSemana) return { texto: 'Todas las clases dictadas están registradas.', tono: TONE.OK }
  return {
    texto: `La semana del ${dayMonth(lunes)} es la más atrasada: ${peorSemana.sinRegistrar} clases sin registrar.`,
    tono: TONE.WARN
  }
}

function sessionsGauge ({ debidas, registradas, docentes }) {
  const ratio = ratioOf(registradas, debidas)
  const [masAtrasado] = docentes
  return {
    tipo: 'medidor',
    titulo: '¿Qué parte de lo dictado está registrado?',
    pista: 'Últimos 30 días',
    pct: percentOf(registradas, debidas),
    etiqueta: 'registrado',
    tono: toneHigherIsBetter(ratio),
    leyenda: [
      { label: 'registradas', valor: registradas, tono: TONE.OK },
      { label: 'sin registrar', valor: debidas - registradas, tono: TONE.BAD }
    ],
    insight: masAtrasado
      ? { texto: `El más atrasado es ${masAtrasado.docente}, con ${masAtrasado.pendientes} clases sin registrar.`, tono: TONE.BAD }
      : null,
    verTodo: null
  }
}

function teachersRanking (docentes) {
  const restantes = docentes.length - RANKING_LIMIT
  return {
    tipo: 'ranking',
    titulo: '¿Qué docentes deben registrar clases?',
    pista: null,
    unidad: 'num',
    items: docentes.slice(0, RANKING_LIMIT).map(d => ({
      label: d.docente,
      sublabel: `${d.aulas} ${d.aulas === 1 ? 'aula' : 'aulas'}, desde el ${d.mas_antigua}`,
      valor: d.pendientes,
      tono: TONE.BAD,
      ruta: null
    })),
    insight: restantes > 0 ? { texto: `Y ${restantes} ${restantes === 1 ? 'docente más' : 'docentes más'} con clases pendientes.`, tono: null } : null,
    verTodo: { ruta: '/academica/reporte', texto: 'Ver seguimiento' }
  }
}

// Momento exclusivo por aula: un curso corto que inicia y termina en la misma
// semana cuenta como "inicia", para que la dona sume el total de aulas.
function weekMomentDonut ({ actual }) {
  const inician = actual.filter(a => a.inicia).length
  const terminan = actual.filter(a => !a.inicia && a.termina).length
  const sinDocente = actual.filter(a => a.sin_docente).length
  return {
    tipo: 'dona',
    titulo: '¿En qué momento están las aulas de esta semana?',
    pista: 'Semana actual',
    unidad: 'num',
    total: actual.length,
    etiquetaTotal: 'aulas',
    segmentos: [
      { label: 'Inician', valor: inician, tono: 'secundario' },
      { label: 'En curso', valor: actual.length - inician - terminan, tono: 'principal' },
      { label: 'Terminan', valor: terminan, tono: 'neutro' }
    ],
    insight: sinDocente
      ? { texto: `${sinDocente} ${sinDocente === 1 ? 'aula no tiene' : 'aulas no tienen'} docente asignado.`, tono: TONE.BAD }
      : null,
    verTodo: { ruta: '/academica/control-ediciones', texto: 'Control de ediciones' }
  }
}

function gradesGauge ({ total, conNota }) {
  return {
    tipo: 'medidor',
    titulo: '¿Las aulas que cerraron tienen notas?',
    pista: 'Finalizadas en 60 días',
    pct: percentOf(conNota, total),
    etiqueta: 'con notas',
    tono: toneHigherIsBetter(ratioOf(conNota, total)),
    leyenda: [
      { label: 'con notas', valor: conNota, tono: TONE.OK },
      { label: 'sin notas', valor: total - conNota, tono: TONE.BAD }
    ],
    insight: null,
    verTodo: null
  }
}

function certificatesGauge ({ aprobados, emitidos }) {
  return {
    tipo: 'medidor',
    titulo: '¿Los aprobados ya tienen certificado?',
    pista: 'Finalizadas en 60 días',
    pct: percentOf(emitidos, aprobados),
    etiqueta: 'certificados',
    tono: toneHigherIsBetter(ratioOf(emitidos, aprobados)),
    leyenda: [
      { label: 'emitidos', valor: emitidos, tono: TONE.OK },
      { label: 'pendientes', valor: aprobados - emitidos, tono: TONE.WARN }
    ],
    // Los deudores quedan sin certificado a propósito (fin_overdue).
    insight: { texto: 'Los alumnos con deuda no se certifican: parte de lo pendiente es a propósito.', tono: null },
    verTodo: null
  }
}

function smallClassroomsRanking ({ actual }) {
  const chicas = actual.filter(a => a.alumnos < SMALL_CLASSROOM).sort((a, b) => a.alumnos - b.alumnos)
  return {
    tipo: 'ranking',
    titulo: '¿Qué aulas en curso tienen menos alumnos?',
    pista: null,
    unidad: 'num',
    items: chicas.slice(0, RANKING_LIMIT).map(a => ({
      label: a.programa,
      sublabel: a.codigo,
      valor: a.alumnos,
      tono: TONE.WARN,
      ruta: classroomRoute(a.edition_num_id)
    })),
    insight: chicas.length
      ? { texto: `${chicas.length} de ${actual.length} aulas en curso tienen menos de ${SMALL_CLASSROOM} alumnos.`, tono: TONE.WARN }
      : null,
    verTodo: { ruta: '/academica/aulas', texto: 'Ver aulas' }
  }
}

// Las más viejas primero: son las que ya deberían tener nota y certificado.
function ungradedTable (aulasFinalizadas, hoy) {
  const sinNotas = aulasFinalizadas
    .filter(a => !(a.con_nota > 0))
    .sort((a, b) => String(a.fin).localeCompare(String(b.fin)))
  return {
    tipo: 'tabla',
    titulo: '¿Qué aulas cerraron sin notas?',
    pista: 'Finalizadas en 60 días',
    columnas: [
      { key: 'programa', label: 'Programa', unidad: 'texto' },
      { key: 'codigo', label: 'Aula', unidad: 'texto' },
      { key: 'fin', label: 'Terminó', unidad: 'texto' },
      { key: 'dias', label: 'Días sin notas', unidad: 'num' }
    ],
    filas: sinNotas.slice(0, TABLE_LIMIT).map(a => {
      const dias = daysBetween(a.fin, hoy)
      return {
        programa: a.programa,
        codigo: a.codigo,
        fin: dayMonth(a.fin),
        dias,
        // Una semana es margen razonable para cargar notas; después ya es atraso.
        tono_dias: dias > 7 ? TONE.BAD : TONE.WARN,
        ruta: classroomRoute(a.edition_num_id)
      }
    }),
    insight: sinNotas.length > TABLE_LIMIT
      ? { texto: `Se muestran las ${TABLE_LIMIT} más antiguas de ${sinNotas.length} aulas sin notas.`, tono: null }
      : null,
    verTodo: { ruta: '/academica/control-ediciones', texto: 'Ver todas' }
  }
}

// ── Fechas ──────────────────────────────────────────────────────────────
// Todo en UTC sobre 'YYYY-MM-DD': mezclar Date.UTC con getters locales corre
// la fecha un día en Lima.

function mondayOf (date) {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const DAY_MS = 24 * 60 * 60 * 1000
const daysBetween = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${String(desde).slice(0, 10)}T00:00:00Z`)) / DAY_MS)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayMonth = (date) => `${String(date).slice(8, 10)}/${String(date).slice(5, 7)}`
