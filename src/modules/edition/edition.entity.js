// Reglas puras del dominio edition. Sin BD, Odoo, Slack ni red.

// Normaliza el filtro 'active' al dominio del SP ('Y' | 'N' | string | null).
// Semantica del listado: booleano -> Y/N, string -> tal cual, resto -> null.
export function normalizeActive (active) {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string') return active
  return null
}

// Variante para el caller: por defecto 'Y' (filtra activos), trata el string
// vacio como ausencia de filtro (null), a diferencia del listado general.
export function normalizeActiveForCaller (active = 'Y') {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string' && active !== '') return active
  return null
}

// Construye el objeto de filtros para sp_edition_list aplicando defaults y la
// normalizacion de 'active'. Los multiselect caen a [] para que el SP los
// convierta internamente a NULL e ignore el filtro.
export function buildEditionFilters (payload = {}) {
  const {
    date_from = null,
    date_to = null,
    program_version_id = null,
    clasification = null,
    active = null,
    q = null,
    page = 1,
    size = 25,
    instructores_seleccionados = [],
    category_ids = [],
    type_program_ids = [],
    combination_days_ids = [],
    hour_combination_ids = [],
    segment_ids = [],
    course_category_ids = [],
    model_modality_ids = []
  } = payload

  let activeParam = active
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'

  const filters = {
    date_from,
    date_to,
    program_version_id,
    clasification,
    active: activeParam,
    q,
    page,
    size,
    instructores_seleccionados,
    category_ids,
    type_program_ids,
    combination_days_ids,
    hour_combination_ids,
    segment_ids,
    course_category_ids,
    model_modality_ids
  }

  return { filters, page, size }
}

// Construye los filtros para sp_edition_by_week_list resolviendo mes/anio
// seleccionados contra la fecha actual inyectada. El reloj se inyecta para que
// la funcion sea pura y testeable.
export function buildEditionByWeekFilters (payload = {}, now = new Date()) {
  const {
    page = 1,
    size = 25,
    selectedMonth,
    selectedYear,
    active,
    ...rest
  } = payload

  let activeParam = active
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'

  const monthNum = Number(selectedMonth) || (now.getMonth() + 1)
  const yearNum = Number(selectedYear) || now.getFullYear()

  const filters = {
    ...rest,
    selectedMonth: monthNum,
    selectedYear: yearNum,
    active: activeParam,
    page,
    size
  }

  return { filters, page, size }
}

// Valida el payload de la migracion A5: edition_num_id > 0 y al menos una
// migracion. Devuelve el id resuelto o null cuando es invalido.
export function buildA5Payload (payload = {}) {
  const editionId = Number(payload.edition_num_id)
  // La lista de destinos puede venir vacia: una edicion cuyos unicos alumnos son
  // modulos de un paquete no tiene ninguna venta propia que proponer, y aun asi
  // hay que poder cancelarla. Que no falte ningun destino EXIGIBLE lo decide
  // buildA5MigrationPlan contra lo que hay vivo en la BD.
  const valid = Number.isFinite(editionId) && editionId > 0
  return { valid, editionId }
}

// Plan de destinos A5: cruza las VENTAS vivas de la edicion contra los destinos
// que propuso Producto.
//
// Solo entran las ventas propias. Un modulo de un paquete (hijo) no lleva
// destino: el caso vive en su venta y mover la venta le vuelve a crear los hijos
// en el destino, asi que un destino propio para el hijo seria una propuesta que
// nadie puede ejecutar. El hijo caido igual llega a la bandeja, adentro de su
// venta, y ahi lo resuelve Academica.
//
// Regla dura: si UNA sola venta queda sin destino no se propone nada y la edicion
// no se cancela. Cancelar dejando alumnos a medias es invisible —el cronograma
// oculta las filas A5— pero sus modulos siguen ocupando el AULA de otros cursos.
//
// La fuente de verdad es `pending` (lo que hay vivo AHORA en la BD), no la lista
// que mando el cliente: un destino para alguien que ya no esta vigente se ignora,
// pero una venta vigente sin destino bloquea todo.
export function buildA5MigrationPlan (pending = [], migrations = []) {
  const destinoDe = new Map(
    (migrations || []).map((m) => [Number(m.enrollment_id), Number(m.target_edition_id) || null])
  )
  const conDestino = (e) => destinoDe.get(Number(e.enrollment_id)) || null
  const ventas = (pending || []).filter((e) => !e.is_child)

  const sinDestino = ventas.filter((e) => !conDestino(e))
  if (sinDestino.length > 0) return { valid: false, sinDestino, plan: [] }

  return {
    valid: true,
    sinDestino: [],
    plan: ventas.map((e) => ({
      enrollmentId: Number(e.enrollment_id),
      targetEditionId: conDestino(e)
    }))
  }
}

// Valida los parametros de la rubrica de auditoria: edition_id finito y
// session_number finito >= 1.
export function validateRubricParams (edition_id, session_number) {
  const eid = Number(edition_id)
  const sn = Number(session_number)
  const valid = Number.isFinite(eid) && Number.isFinite(sn) && sn >= 1
  return { valid, eid, sn }
}

// =====================================================================
// Lista de Notas por alumno (classroom_student_grades)
// =====================================================================

// Reglas de la Lista de Notas (formato oficial del area academica, ISO 21001).
// Pesos sobre /20: tests 6, participacion 2 (aditiva), parcial 6, final 8.
// Confirmado por el area academica el 2026-09-03: la sesion sin test cuenta 0 y
// se promedia sobre el TOTAL de sesiones del aula (no solo sobre las cargadas).
// Consecuencia: mientras el aula no tenga todos los quizzes cargados, la nota
// del ERP sale mas baja que la real. La nota OFICIAL del certificado es la que
// calcula Odoo, no esta (ver certifyClassroom en config/odooClient.js).
export const GRADE_RULES = Object.freeze({
  TEST_MAX_PER_SESSION: 20, // nota del TEST FINAL del quiz de la sesion (0-20)
  CRITERIA_MAX: 20, // cada criterio se califica de 0 a 20
  PARTIAL_CRITERIA_WEIGHTS: Object.freeze([0.4, 0.4, 0.2]), // claves "1".."3", ponderado /20
  FINAL_CRITERIA_WEIGHTS: Object.freeze([0.3, 0.3, 0.2, 0.2]), // claves "1".."4", ponderado /20
  WEIGHT_TEST: 0.30,
  WEIGHT_PARTIAL: 0.30,
  WEIGHT_FINAL: 0.40,
  PARTICIPATION_MAX: 2,
  PASS_THRESHOLD: 12,
  CAP_FINAL_AT_20: true
})

const round2 = (n) => Math.round(n * 100) / 100

function clampNumber (value, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(n, 0), max)
}

// Clampa un JSONB de criterios {"1": n, ...}: cada criterio va de 0 a 20.
// Las claves fuera de rango se descartan; los valores invalidos caen a null.
function sanitizeCriteria (criteria, weights) {
  const out = {}
  if (!criteria || typeof criteria !== 'object') return out
  weights.forEach((_, i) => {
    const key = String(i + 1)
    if (criteria[key] === undefined) return
    out[key] = clampNumber(criteria[key], GRADE_RULES.CRITERIA_MAX)
  })
  return out
}

// Total /20 de un entregable: promedio ponderado de sus criterios (0-20 c/u).
function weightedCriteriaScore (criteria, weights) {
  return round2(weights.reduce((acc, w, i) => {
    const v = Number(criteria?.[String(i + 1)])
    return acc + (Number.isFinite(v) ? v * w : 0)
  }, 0))
}

// Sanea una fila del bulk de notas: clamps por celda en vez de rechazar el
// payload completo (una celda fuera de rango no debe tumbar el guardado de
// los demas alumnos).
export function sanitizeGradeItem (item = {}) {
  const tests = {}
  if (item.tests && typeof item.tests === 'object') {
    for (const [key, value] of Object.entries(item.tests)) {
      const sn = Number(key)
      if (!Number.isInteger(sn) || sn < 1) continue
      tests[String(sn)] = clampNumber(value, GRADE_RULES.TEST_MAX_PER_SESSION)
    }
  }

  const participation = {}
  if (item.participation && typeof item.participation === 'object') {
    for (const [key, value] of Object.entries(item.participation)) {
      const sn = Number(key)
      if (!Number.isInteger(sn) || sn < 1) continue
      participation[String(sn)] = value === true
    }
  }

  const groupNumber = Number(item.group_number)
  const trackingCode = typeof item.tracking_code === 'string'
    ? item.tracking_code.trim().slice(0, 50)
    : ''
  const observation = typeof item.observation === 'string'
    ? item.observation.trim().slice(0, 2000)
    : ''

  return {
    enrollment_id: Number(item.enrollment_id),
    tests,
    participation,
    partial_criteria: sanitizeCriteria(item.partial_criteria, GRADE_RULES.PARTIAL_CRITERIA_WEIGHTS),
    final_criteria: sanitizeCriteria(item.final_criteria, GRADE_RULES.FINAL_CRITERIA_WEIGHTS),
    group_number: Number.isInteger(groupNumber) && groupNumber > 0 ? groupNumber : null,
    tracking_code: trackingCode || null,
    observation: observation || null
  }
}

// Puntos de participacion 0-2: proporcional a los checks sobre el total de
// sesiones del aula, redondeado. Consistente con el sheet oficial
// (5/6 checks -> 2, 1/6 -> 0). Regla exacta pendiente de confirmar.
export function participationScore (participation = {}, sessionsTotal = 0) {
  if (!sessionsTotal) return 0
  const checks = Object.values(participation).filter((v) => v === true).length
  return Math.min(
    Math.round((checks * GRADE_RULES.PARTICIPATION_MAX) / sessionsTotal),
    GRADE_RULES.PARTICIPATION_MAX
  )
}

// Totales de una fila ya saneada. El promedio de tests se toma sobre el total
// de sesiones del aula (sesion sin nota = 0), igual que el sheet oficial.
// NOTA FINAL = test*0.30 + parcial*0.30 + final*0.40 + participacion.
export function computeGradeTotals (item, sessionsTotal = 0) {
  const sumValues = (obj) => Object.values(obj || {})
    .reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0)

  // TEST /20 = promedio de los tests de sesion (cada uno ya viene 0-20)
  const testScore = sessionsTotal > 0
    ? round2(sumValues(item.tests) / sessionsTotal)
    : 0
  const partScore = participationScore(item.participation, sessionsTotal)
  const partialScore = weightedCriteriaScore(item.partial_criteria, GRADE_RULES.PARTIAL_CRITERIA_WEIGHTS)
  const finalDelivScore = weightedCriteriaScore(item.final_criteria, GRADE_RULES.FINAL_CRITERIA_WEIGHTS)

  let finalGrade = round2(
    testScore * GRADE_RULES.WEIGHT_TEST +
    partialScore * GRADE_RULES.WEIGHT_PARTIAL +
    finalDelivScore * GRADE_RULES.WEIGHT_FINAL +
    partScore
  )
  if (GRADE_RULES.CAP_FINAL_AT_20) finalGrade = Math.min(finalGrade, 20)

  return {
    test_score: testScore,
    participation_score: partScore,
    partial_score: partialScore,
    final_deliv_score: finalDelivScore,
    final_grade: finalGrade
  }
}

// =====================================================================
// Observaciones IA (Ollama local via tunel SSH)
// =====================================================================

// Resuelve y valida la URL del Ollama local contra la misma allowlist del
// auditor IA (loopback + AI_AUDITOR_ALLOWED_HOSTS). Lanza si el host no esta
// permitido. Se invoca en la primera llamada, no en import-time.
export function resolveOllamaUrl (env = process.env) {
  const raw = env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const allowed = aiAuditorAllowedHosts(env)
  let hostname
  try {
    hostname = new URL(raw).hostname
  } catch (err) {
    throw new Error(`OLLAMA_URL invalida: ${err.message}`)
  }
  if (!allowed.has(hostname)) {
    throw new Error(`OLLAMA_URL host no permitido: ${hostname}. Agregalo a AI_AUDITOR_ALLOWED_HOSTS.`)
  }
  return raw
}

// Observacion fija para alumnos sin ninguna nota: no pasa por el modelo.
export const OBS_SIN_NOTAS =
  'No registra evaluaciones en el aula: sin tests, participacion ni entregables a la fecha.'

// Prompt de observacion por alumno para el acta. Recibe SOLO datos ya
// calculados (el modelo nunca calcula notas). Few-shot porque con un 7B los
// ejemplos pesan mas que las instrucciones.
export function buildObservationPrompt (student, totals, sessionsTotal, rules = GRADE_RULES) {
  const missedTests = []
  for (let n = 1; n <= sessionsTotal; n++) {
    if (!(Number(student.tests?.[String(n)]) > 0)) missedTests.push(`S${n}`)
  }
  const participated = Object.values(student.participation || {}).filter((v) => v === true).length
  const resultado = totals.final_grade >= rules.PASS_THRESHOLD ? 'APROBADO' : 'DESAPROBADO'

  const system =
    'Eres asistente del area academica de una escuela de posgrado. Redactas la ' +
    'observacion del acta de notas de un alumno: espanol formal, MAXIMO 2 frases, ' +
    'tercera persona, solo con los datos provistos. No inventes datos, causas ni ' +
    'promesas. No repitas todas las cifras: menciona la nota final y lo mas relevante.'

  const user =
    'Ejemplo 1:\n' +
    'Datos: nota_final=18.3/20 (APROBADO, minimo 12); tests=18/20; participacion=2/2 (participo en 5 de 6 sesiones); entregable_parcial=15/20; entregable_final=16/20; sesiones_sin_test=S6.\n' +
    'Observacion: Aprobo el curso con nota final de 18.3, destacando por su participacion constante y un desempeno solido en los tests. Se sugiere reforzar el entregable parcial, su componente mas bajo.\n\n' +
    'Ejemplo 2:\n' +
    'Datos: nota_final=7.4/20 (DESAPROBADO, minimo 12); tests=6/20; participacion=0/2 (participo en 0 de 6 sesiones); entregable_parcial=8/20; entregable_final=9/20; sesiones_sin_test=S3, S5, S6.\n' +
    'Observacion: Desaprobo el curso con nota final de 7.4, con baja participacion y tests pendientes en tres sesiones. Se recomienda reprogramacion y acompanamiento academico.\n\n' +
    'Ahora redacta la observacion para:\n' +
    `Datos: nota_final=${totals.final_grade}/20 (${resultado}, minimo ${rules.PASS_THRESHOLD}); ` +
    `tests=${totals.test_score}/20; ` +
    `participacion=${totals.participation_score}/${rules.PARTICIPATION_MAX} (participo en ${participated} de ${sessionsTotal} sesiones); ` +
    `entregable_parcial=${totals.partial_score}/20; ` +
    `entregable_final=${totals.final_deliv_score}/20; ` +
    `sesiones_sin_test=${missedTests.length ? missedTests.join(', ') : 'ninguna'}.\n` +
    'Observacion:'

  return { system, user }
}

// Prompt del resumen ejecutivo del aula para la lider academica.
export function buildAulaSummaryPrompt (summary, rules = GRADE_RULES) {
  const system =
    'Eres asistente del area academica. Redactas un resumen ejecutivo del cierre ' +
    'de un aula para la lider academica: espanol formal, un solo parrafo de 3 a 4 ' +
    'frases, solo con los datos provistos, sin inventar causas ni recomendaciones ' +
    'que no se desprendan de los datos.'

  const top = (summary.top || [])
    .map((t, i) => `${i + 1}. ${t.name} (${t.final})`)
    .join('; ')

  const user =
    `Datos del aula ${summary.codigo || ''} (${summary.programa || 'programa'}):\n` +
    `- Alumnos: ${summary.total} (regular ${summary.regular}, flex ${summary.flex})\n` +
    `- Aprobados: ${summary.approved} | Desaprobados: ${summary.failed} (minimo ${rules.PASS_THRESHOLD}/20)\n` +
    `- Promedio de nota final (con notas): ${summary.average ?? 'sin notas'}\n` +
    `- Alumnos sin ninguna nota registrada: ${summary.ungraded}\n` +
    `- Primeros puestos: ${top || 'sin notas registradas'}\n` +
    'Resumen ejecutivo:'

  return { system, user }
}

// Prompt de recomendaciones del Reporte Academico. Recibe un snapshot con
// indicadores YA calculados por el frontend (el modelo nunca calcula): la
// tarea es solo redactar 3 recomendaciones accionables en tono constructivo.
export function buildReportRecommendationsPrompt (s = {}) {
  const system =
    'Eres asesor del area academica de una escuela de posgrado. A partir de ' +
    'indicadores ya calculados generas EXACTAMENTE 3 recomendaciones accionables ' +
    'para esta semana: tono constructivo y propositivo, nunca alarmista. No ' +
    'inventes datos ni cifras que no esten en los indicadores. Respondes ' +
    'UNICAMENTE con un array JSON valido de 3 objetos con estas claves: ' +
    '"etiqueta" (1-2 palabras en MAYUSCULAS), "titulo" (maximo 8 palabras), ' +
    '"detalle" (2 frases, puede citar cifras provistas), "responsable" (rol del ' +
    'equipo academico). Nada de texto fuera del JSON.'

  const docentes = (s.worst_teachers || [])
    .map((t) => `${t.name} (promedio ${t.avg ?? 'sin notas'}, ${t.at_risk} de ${t.total} aulas en riesgo)`)
    .join('; ') || 'sin datos'
  const aulas = (s.critical_aulas || [])
    .map((a) => `${a.code} ${a.name} (consolidada ${a.score ?? 'sin nota'}, ${a.verdict})`)
    .join('; ') || 'sin datos'

  const user =
    'Ejemplo del formato de respuesta (los valores son ilustrativos):\n' +
    '[{"etiqueta":"COBERTURA","titulo":"Completar evaluaciones pendientes","detalle":"La cobertura del periodo es 62%. Priorizar la carga de sesiones sin evidencia para consolidar el promedio.","responsable":"Coordinadores de area"},' +
    '{"etiqueta":"ACOMPANAMIENTO","titulo":"Mentoria para docentes con promedio bajo","detalle":"Dos docentes concentran las aulas en riesgo. Agendar sesiones de retroalimentacion esta semana.","responsable":"Jefatura Academica"},' +
    '{"etiqueta":"RECONOCIMIENTO","titulo":"Difundir practicas de las mejores aulas","detalle":"Las aulas sobre la meta pueden servir de referencia. Documentar y compartir sus practicas con el resto.","responsable":"Direccion Academica"}]\n\n' +
    `Indicadores del periodo ${s.period_start || ''} a ${s.period_end || ''}:\n` +
    `- Aulas en el periodo: ${s.total ?? 0} (evaluadas: ${s.evaluated ?? 0}, en riesgo: ${s.at_risk ?? 0})\n` +
    `- Promedio consolidado: ${s.avg_consolidated ?? 'sin notas'} sobre 20 (meta institucional ${s.goal ?? 17})\n` +
    `- Promedio evaluacion IA: ${s.avg_ia ?? 'sin notas'} | Promedio rubrica manual: ${s.avg_manual ?? 'sin notas'}\n` +
    `- Cobertura de evidencia: ${s.coverage_pct ?? 0}% (IA ${s.coverage_ia_pct ?? 0}%, manual ${s.coverage_manual_pct ?? 0}%)\n` +
    `- Docentes con menor promedio: ${docentes}\n` +
    `- Aulas mas criticas: ${aulas}\n\n` +
    'Responde con el array JSON de exactamente 3 recomendaciones:'

  return { system, user }
}

// Extrae y sanea el array JSON de recomendaciones de la respuesta del modelo.
// Un 7B a veces envuelve el JSON en texto o markdown: tomamos del primer '['
// al ultimo ']'. Devuelve [] si no hay 3 items validos que rescatar.
export function parseReportRecommendations (text) {
  const raw = String(text || '')
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  let arr
  try {
    arr = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return arr
    .map((r) => ({
      etiqueta: clean(r?.etiqueta, 30).toUpperCase() || 'SUGERENCIA',
      titulo: clean(r?.titulo, 90),
      detalle: clean(r?.detalle, 400),
      responsable: clean(r?.responsable, 60) || 'Area Academica'
    }))
    .filter((r) => r.titulo && r.detalle)
    .slice(0, 3)
}

// Hosts permitidos para el sidecar de IA. Loopback siempre + los declarados en
// AI_AUDITOR_ALLOWED_HOSTS. Funcion para diferir la lectura del env al primer
// uso (no en import-time) y evitar que un host invalido tumbe el arranque.
export function aiAuditorAllowedHosts (env = process.env) {
  return new Set([
    '127.0.0.1', 'localhost', '::1',
    ...(env.AI_AUDITOR_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
  ])
}

// Logica anti-SSRF: solo se acepta una URL cuyo host este en la allowlist.
// Pura y testeable sin red; recibe el set de hosts permitidos.
export function isValidAiAuditorHost (url, allowedHosts) {
  try {
    const u = new URL(url)
    return allowedHosts.has(u.hostname)
  } catch {
    return false
  }
}

// Resuelve y valida la URL del auditor IA contra la allowlist. Lanza si el host
// no esta permitido o la URL es invalida. Se invoca en la primera llamada al
// endpoint, no en import-time.
export function resolveAiAuditorUrl (env = process.env) {
  const raw = env.AI_AUDITOR_URL || 'http://127.0.0.1:8090'
  const allowed = aiAuditorAllowedHosts(env)
  let hostname
  try {
    hostname = new URL(raw).hostname
  } catch (err) {
    throw new Error(`AI_AUDITOR_URL invalida: ${err.message}`)
  }
  if (!allowed.has(hostname)) {
    throw new Error(`AI_AUDITOR_URL host no permitido: ${hostname}. Agregalo a AI_AUDITOR_ALLOWED_HOSTS.`)
  }
  return raw
}

// =====================================================================
// Vista Semanal Academica: aulas en curso por dia con nº de sesion.
// Las fechas de cada sesion NO estan en BD: se derivan de start_date +
// dias permitidos (we_day_combination.variable_2) + feriados (we_holiday),
// con la misma matematica que getNthSession en pdf.service.js.
// =====================================================================

// Parsea 'YYYY-MM-DD' (o ISO con hora) a Date local, evitando el corrimiento
// UTC de un dia. Mismo helper que pdf.service.js y ScheduleBoard.vue.
export function parseLocalDate (str) {
  if (!str) return null
  const [y, m, d] = String(str).split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toYmd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Rango lunes-domingo de una semana ISO ("semana comercial"). El 4 de enero
// siempre cae en la semana ISO 1, asi que el lunes de la semana N es el lunes
// de la semana del 4-ene desplazado (N-1)*7 dias.
export function isoWeekRange (year, week) {
  const jan4 = new Date(year, 0, 4)
  const isodow = jan4.getDay() === 0 ? 7 : jan4.getDay()
  const monday = new Date(year, 0, 4 - (isodow - 1) + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { date_start: toYmd(monday), date_end: toYmd(sunday) }
}

// Dias de la semana permitidos (0=dom..6=sab) segun variable_2 del catalogo
// we_day_combination. Fallback sin combinacion: el weekday de start_date,
// mismo criterio que el PDF de programacion.
export function getAllowedDays (dayCombos = [], catDayCombinationId, startDateStr) {
  // sp_catalog_list entrega id como string y el campo se llama catalogo_id:
  // comparar numericamente o el combo nunca matchea y todo cae al fallback.
  const wanted = Number(catDayCombinationId)
  const entry = dayCombos.find(
    (c) => Number(c.id) === wanted || Number(c.catalog_id ?? c.catalogo_id) === wanted
  )
  try {
    const parsed = JSON.parse(entry?.variable_2 ?? 'null')
    if (Array.isArray(parsed) && parsed.length) return parsed
  } catch { /* variable_2 malformado: cae al fallback */ }
  const start = parseLocalDate(startDateStr)
  return start ? [start.getDay()] : []
}

// Map 'YYYY-MM-DD' -> nº de sesion para las fechas dentro de [rangeStart,
// rangeEnd]: itera desde start_date contando dias permitidos no feriados
// (tope 1500 iteraciones, como pdf.service.js). Corta al agotar totalSessions
// o al pasar endDateStr (fin real del aula).
export function sessionNumbersForRange ({
  startDateStr, endDateStr = null, allowedDays = [], holidaySet = new Set(),
  totalSessions = 0, rangeStart, rangeEnd
}) {
  const out = new Map()
  const iter = parseLocalDate(startDateStr)
  let stop = parseLocalDate(rangeEnd)
  const editionEnd = parseLocalDate(endDateStr)
  if (editionEnd && editionEnd < stop) stop = editionEnd
  if (!iter || !stop || !allowedDays.length) return out
  let counted = 0
  for (let i = 0; i < 1500 && iter <= stop; i++) {
    const key = toYmd(iter)
    if (allowedDays.includes(iter.getDay()) && !holidaySet.has(key)) {
      counted++
      if (totalSessions && counted > totalSessions) break
      if (key >= rangeStart) out.set(key, counted)
    }
    iter.setDate(iter.getDate() + 1)
  }
  return out
}

// Construye los 7 dias (lunes-domingo) de la vista semanal volcando en cada
// dia las ediciones que dictan sesion esa fecha, con su nº de sesion.
export function buildWeeklySessionDays ({
  date_start, date_end, rows = [], dayCombos = [], holidaySet = new Set()
}) {
  const days = []
  const byDate = new Map()
  const monday = parseLocalDate(date_start)
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = toYmd(d)
    const day = { date: key, weekday: d.getDay(), holiday: holidaySet.has(key), editions: [] }
    days.push(day)
    byDate.set(key, day)
  }
  for (const r of rows) {
    const allowedDays = getAllowedDays(dayCombos, Number(r.cat_day_combination_id), r.start_date)
    const sessions = sessionNumbersForRange({
      startDateStr: r.start_date,
      endDateStr: r.end_date,
      allowedDays,
      holidaySet,
      totalSessions: Number(r.total_sessions) || 0,
      rangeStart: date_start,
      rangeEnd: date_end
    })
    for (const [dateKey, sessionNumber] of sessions) {
      byDate.get(dateKey)?.editions.push({
        edition_num_id: r.edition_num_id,
        abbreviation: r.abbreviation,
        specific_code: r.specific_code,
        session_number: sessionNumber,
        total_sessions: Number(r.total_sessions) || 0,
        day_label: r.day_label,
        hour_label: r.hour_label,
        instructor: r.instructor,
        start_date: r.start_date,
        end_date: r.end_date
      })
    }
  }
  return days
}

// =====================================================================
// Control de ediciones (gestion academica por sesion, espejo de la hoja
// "3. Control de ediciones"): el cronograma se sigue DERIVANDO; solo se
// persisten overrides {status A/R/T, new_date} en edition_session_control.
// =====================================================================

// Tope de reprogramaciones POR CURSO (suma de todos los cambios de fecha de
// todas sus sesiones, incluyendo re-reprogramar la misma sesion).
export const MAX_EDITION_REPROS = 3

// Eventos de reprogramacion de un override. Fallback new_date?1:0 para filas
// creadas antes de la columna repro_times.
export const reproEventsOf = (c = {}) =>
  Math.max(Number(c.repro_times) || 0, c.new_date ? 1 : 0)

// Cronograma completo de un aula aplicando overrides. Reprogramar CORRE las
// sesiones siguientes: la sesion con new_date se dicta en su nueva fecha y
// las posteriores continuan la frecuencia desde ahi (siguiente dia permitido
// no feriado). Solo la reprogramada muestra tachado (new_date); las demas
// simplemente "corren" con planned_date ya desplazada.
// Ej.: Dom 31/5, 7/6, 14/6... y la S2 (7/6) R->28/6 => 31/5, 28/6(R), 5/7, 12/7...
export function buildSessionSchedule ({
  startDateStr, allowedDays = [], holidaySet = new Set(),
  totalSessions = 0, overrides = new Map()
}) {
  const out = []
  let cursor = parseLocalDate(startDateStr)
  if (!cursor || !allowedDays.length || !totalSessions) return out
  for (let n = 1; n <= totalSessions; n++) {
    let guard = 0
    while (guard++ < 1500 && (!allowedDays.includes(cursor.getDay()) || holidaySet.has(toYmd(cursor)))) {
      cursor.setDate(cursor.getDate() + 1)
    }
    if (guard > 1500) break
    const planned = toYmd(cursor)
    const ov = overrides.get(n) || {}
    out.push({
      session_number: n,
      planned_date: planned,
      date: ov.new_date || planned,
      status: ov.status || null,
      new_date: ov.new_date || null,
      repro_times: ov.repro_times || 0
    })
    // Cascada: las siguientes sesiones parten de la fecha efectiva de esta.
    if (ov.new_date) cursor = parseLocalDate(ov.new_date) || cursor
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

// Fila del control: cabecera del aula + sesiones (orden cronologico) +
// derivados. Sesion actual = primera posicion AUN NO DICTADA (ni A ni T; una
// R futura sigue pendiente de dictarse); todas dictadas = 'CULMINÓ'. Repros
// cuenta reprogramadas (new_date u estado R) aunque luego se marquen A.
export function buildControlRow (r, { dayCombos = [], holidaySet = new Set(), controls = [] } = {}) {
  const overrides = new Map(
    controls
      .filter((c) => Number(c.program_edition_id) === Number(r.edition_num_id))
      .map((c) => [Number(c.session_number), {
        status: c.status || null,
        new_date: c.new_date ? String(c.new_date).slice(0, 10) : null,
        repro_times: reproEventsOf(c)
      }])
  )
  const allowedDays = getAllowedDays(dayCombos, Number(r.cat_day_combination_id), r.start_date)
  const sessions = buildSessionSchedule({
    startDateStr: r.start_date,
    allowedDays,
    holidaySet,
    totalSessions: Number(r.total_sessions) || 0,
    overrides
  })
  const pendingIdx = sessions.findIndex((s) => s.status !== 'A' && s.status !== 'T')
  return {
    edition_num_id: r.edition_num_id,
    abbreviation: r.abbreviation,
    specific_code: r.specific_code,
    class_code: r.class_code,
    instructor: r.instructor,
    day_label: r.day_label,
    hour_label: r.hour_label,
    new_methodology: r.new_methodology === 'Y',
    start_date: r.start_date,
    end_date: r.end_date,
    total_sessions: Number(r.total_sessions) || 0,
    sessions,
    current_label: sessions.length ? (pendingIdx !== -1 ? `S${pendingIdx + 1}` : 'CULMINÓ') : '',
    // Repros = EVENTOS de reprogramacion del curso (re-reprogramar suma otra).
    repro_count: sessions.reduce((a, s) => a + (s.repro_times || (s.status === 'R' ? 1 : 0)), 0),
    repro_max: MAX_EDITION_REPROS,
    tardy_count: sessions.filter((s) => s.status === 'T').length
  }
}

// Seguimiento Docentes: pega la nota de auditoria sobre el cronograma
// derivado. Una sesion sin fila en la rubrica queda en null — "todavia no
// auditada" no es lo mismo que "auditada en cero", y la vista las pinta
// distinto. La nota manual ya viene sobre 20 (cantidad de criterios marcados
// de RUBRIC_TOTAL_ITEMS); la de IA la escalo el repositorio.
export function attachSessionAudits (row, auditRows = []) {
  const byNumber = new Map(
    auditRows
      .filter((a) => Number(a.program_edition_id) === Number(row.edition_num_id))
      .map((a) => [Number(a.session_number), a])
  )
  return {
    ...row,
    sessions: row.sessions.map((s) => {
      const audit = byNumber.get(Number(s.session_number))
      const manual = Number(audit?.manual_marked)
      const ai = Number(audit?.ai_score20)
      return {
        ...s,
        manual_20: Number.isFinite(manual) && manual > 0 ? manual : null,
        ai_20: Number.isFinite(ai) ? ai : null,
        audited_at: audit?.audited_at || null
      }
    })
  }
}

// ===================================================================
// Cierre de cursos: las 6 tareas que el area Academica cierra cuando un aula
// termina (hoja "CIERRE DE CURSOS"). El orden es el de la hoja y define el de
// las columnas: cambiarlo aqui las mueve en la vista.
// ===================================================================
export const CLOSURE_CHECKS = [
  { field: 'survey_reinforced', label: 'Refuerz. enc. final' },
  { field: 'grades_delivered', label: 'Entregó notas' },
  { field: 'certificate_done', label: 'Certificado' },
  { field: 'debt_validated', label: 'Val. deuda' },
  { field: 'teacher_survey', label: 'Enc. docente' },
  { field: 'final_report_sent', label: 'Reporte final' }
]

// El cierre REAL de un aula es su ultima sesion con reprogramaciones aplicadas,
// no el end_date planificado: una R al final corre el cierre a otra semana y la
// bandeja tiene que seguirlo, si no el aula se revisa la semana equivocada.
export function closingDateOf (row) {
  return row.sessions?.[row.sessions.length - 1]?.date || row.end_date
}

// Pega el checklist sobre la fila del control. Un aula sin fila en
// edition_closure no es un error: es un cierre que nadie empezo a gestionar.
export function buildClosureRow (row, closureRows = []) {
  const saved = closureRows.find(
    (c) => Number(c.program_edition_id) === Number(row.edition_num_id)
  )
  const checks = Object.fromEntries(
    CLOSURE_CHECKS.map(({ field }) => [field, saved?.[field] === true])
  )
  return {
    edition_num_id: row.edition_num_id,
    abbreviation: row.abbreviation,
    class_code: row.class_code,
    specific_code: row.specific_code,
    instructor: row.instructor,
    day_label: row.day_label,
    hour_label: row.hour_label,
    start_date: row.start_date,
    closing_date: closingDateOf(row),
    total_sessions: row.total_sessions,
    checks,
    done_count: CLOSURE_CHECKS.filter(({ field }) => checks[field]).length,
    updated_at: saved?.updated_at || null
  }
}

// Convierte una fecha DD/MM/YYYY a YYYY-MM-DD. Si no tiene 3 partes, devuelve
// el valor original. Usada en el bulk de WhatsApp para normalizar la fecha.
export function formatStartDate (startDate) {
  const parts = String(startDate).split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  return startDate
}

// =====================================================================
// Seguimiento B2B: asistencia manual, separada de la Lista de Notas.
// =====================================================================

// Estados de asistencia. Sin marcar (clave ausente) NO es falta: es
// "pendiente de tomar", que es distinto de "el alumno no vino".
export const B2B_ATTENDANCE_STATES = ['P', 'T', 'F', 'J']

// Una justificacion sin texto no es una justificacion: el modulo existe para
// que academica DIGA por que el alumno falto. El limite es el de la columna.
export const B2B_JUSTIFICATION_MAX = 500

// REGLA DE NEGOCIO — % de asistencia. Se calcula sobre las sesiones YA
// MARCADAS (no sobre el total del curso), asi un curso a mitad de camino no
// muestra 30% solo por tener sesiones futuras. La tardanza CUENTA como
// asistida (el alumno estuvo en clase) pero se reporta aparte en `tardy`.
// La falta JUSTIFICADA tampoco penaliza: cuenta como asistida en el % y se
// reporta aparte en `justified`. Solo la falta seca (F) baja el porcentaje.
// Si academica decide que la tardanza vale medio punto o que las sesiones ya
// dictadas sin marcar son falta, este es el unico lugar que cambia.
export function b2bAttendanceSummary (sessionsMap = {}, totalSessions = 0) {
  const marks = Object.values(sessionsMap || {})
  const present = marks.filter((s) => s === 'P').length
  const tardy = marks.filter((s) => s === 'T').length
  const absent = marks.filter((s) => s === 'F').length
  const justified = marks.filter((s) => s === 'J').length
  const taken = present + tardy + absent + justified
  return {
    present,
    tardy,
    absent,
    justified,
    taken,
    pending: Math.max(0, (Number(totalSessions) || 0) - taken),
    pct: taken ? Math.round(((present + tardy + justified) / taken) * 100) : null
  }
}
