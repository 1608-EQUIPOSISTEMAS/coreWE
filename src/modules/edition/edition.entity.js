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
  const migrations = Array.isArray(payload.migrations) ? payload.migrations : []
  const valid = Number.isFinite(editionId) && editionId > 0 && migrations.length > 0
  return { valid, editionId }
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
// PASS_THRESHOLD y CAP_FINAL_AT_20 son provisionales hasta confirmacion del
// area academica; se cambian aqui sin tocar nada mas.
export const GRADE_RULES = Object.freeze({
  TEST_MAX_PER_SESSION: 5,
  TEST_MULTIPLIER: 4, // promedio(0-5) * 4 => /20
  PARTIAL_CRITERIA_MAX: Object.freeze([8, 8, 4]), // claves "1".."3"
  FINAL_CRITERIA_MAX: Object.freeze([5, 5, 5, 5]), // claves "1".."4"
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

// Clampa un JSONB de criterios {"1": n, ...} contra sus maximos. Las claves
// fuera de rango se descartan; los valores invalidos caen a null.
function sanitizeCriteria (criteria, maxima) {
  const out = {}
  if (!criteria || typeof criteria !== 'object') return out
  maxima.forEach((max, i) => {
    const key = String(i + 1)
    if (criteria[key] === undefined) return
    out[key] = clampNumber(criteria[key], max)
  })
  return out
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
    partial_criteria: sanitizeCriteria(item.partial_criteria, GRADE_RULES.PARTIAL_CRITERIA_MAX),
    final_criteria: sanitizeCriteria(item.final_criteria, GRADE_RULES.FINAL_CRITERIA_MAX),
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

  const testScore = sessionsTotal > 0
    ? round2((sumValues(item.tests) / sessionsTotal) * GRADE_RULES.TEST_MULTIPLIER)
    : 0
  const partScore = participationScore(item.participation, sessionsTotal)
  const partialScore = round2(sumValues(item.partial_criteria))
  const finalDelivScore = round2(sumValues(item.final_criteria))

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

// Convierte una fecha DD/MM/YYYY a YYYY-MM-DD. Si no tiene 3 partes, devuelve
// el valor original. Usada en el bulk de WhatsApp para normalizar la fecha.
export function formatStartDate (startDate) {
  const parts = String(startDate).split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  return startDate
}
