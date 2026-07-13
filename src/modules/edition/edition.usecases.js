import { editionRepository } from './edition.repository.js'
import { handleSpResponse } from '../../utils/dbResponse.js'
import { getCatalog } from '../catalog/catalog.usecases.js'
import {
  buildEditionFilters,
  buildEditionByWeekFilters,
  isoWeekRange,
  buildWeeklySessionDays,
  buildControlRow,
  reproEventsOf,
  MAX_EDITION_REPROS,
  buildA5Payload,
  validateRubricParams,
  resolveAiAuditorUrl,
  formatStartDate,
  sanitizeGradeItem,
  computeGradeTotals,
  resolveOllamaUrl,
  buildObservationPrompt,
  buildAulaSummaryPrompt,
  OBS_SIN_NOTAS,
  GRADE_RULES
} from './edition.entity.js'
import {
  toSpRowOrFallback,
  toListDto,
  toByWeekDto,
  toUpdateDto,
  toA5MigrationDto
} from './edition.dto.js'

const repo = editionRepository

// REGISTER (simple). El SP devuelve result, response, message.
export async function editionRegister ({ edition = {}, user_id } = {}) {
  const rows = await repo.register(edition, user_id)
  return toSpRowOrFallback(rows)
}

// REGISTER TREE (padre + hijos). handleSpResponse lanza si result === 0.
export async function editionTreeRegister ({ edition = {}, user_id } = {}) {
  const rows = await repo.treeRegister(edition, user_id)
  return handleSpResponse(rows)
}

// LIST con filtros, multiselect y paginacion.
export async function editionList (payload = {}) {
  const { filters, page, size } = buildEditionFilters(payload)
  const rows = await repo.list(filters)
  await attachChannelMetrics(rows)
  return toListDto({ rows, page, size })
}

// LIST BY WEEK: resuelve mes/anio contra la fecha actual.
export async function editionByWeeklist (payload = {}) {
  const { filters, page, size } = buildEditionByWeekFilters(payload)
  const rows = await repo.listByWeek(filters)
  // listByWeek agrupa por semana: cada fila trae items[] de ediciones.
  await attachChannelMetrics((rows || []).flatMap(w => Array.isArray(w.items) ? w.items : []))
  return toByWeekDto({ rows, page, size })
}

// Pega el contador por canal (cnt_ventas/segui/memb/becas/b2b/aula/total) a cada
// edicion del cronograma. Muta los items in-place; las ediciones sin inscritos
// quedan en 0. Una sola consulta agregada para todas las ediciones de la pagina.
async function attachChannelMetrics (items = []) {
  const list = Array.isArray(items) ? items : []
  const ids = [...new Set(list.map(i => Number(i?.edition_num_id)).filter(Number.isFinite))]
  if (!ids.length) return
  const [metrics, leads] = await Promise.all([
    repo.classroomChannelMetricsList(ids),
    repo.classroomLeadsCountList(ids)
  ])
  const byId = new Map(metrics.map(m => [Number(m.edition_num_id), m]))
  const leadsById = new Map(leads.map(l => [Number(l.edition_num_id), l]))
  for (const it of list) {
    const m = byId.get(Number(it?.edition_num_id))
    it.cnt_ventas = m?.cnt_ventas ?? 0
    it.cnt_segui = m?.cnt_segui ?? 0
    it.cnt_memb = m?.cnt_memb ?? 0
    it.cnt_becas = m?.cnt_becas ?? 0
    it.cnt_b2b = m?.cnt_b2b ?? 0
    it.cnt_aula = m?.cnt_aula ?? 0
    it.cnt_total = m?.cnt_total ?? 0
    // consultas (leads, excluye Desestimado/Cerrado)
    it.cnt_consultas = leadsById.get(Number(it?.edition_num_id))?.cnt_consultas ?? 0
  }
}

// Vista Semanal Academica: aulas en curso por dia (lunes-domingo) de una
// semana ISO, con nº de sesion derivado (no persistido) desde start_date +
// dias permitidos + feriados, misma matematica que el PDF de programacion.
export async function editionWeeklySessions ({ year, week } = {}) {
  const y = Number(year)
  const w = Number(week)
  const { date_start, date_end } = isoWeekRange(y, w)
  const [rows, catalog] = await Promise.all([
    repo.weeklySessions(date_start, date_end),
    getCatalog()
  ])
  const holidaySet = new Set(
    (catalog.we_holiday || []).map((h) => h.variable_3).filter(Boolean)
  )
  const days = buildWeeklySessionDays({
    date_start,
    date_end,
    rows,
    dayCombos: catalog.we_day_combination || [],
    holidaySet
  })
  return { year: y, week: w, date_start, date_end, days }
}

// Control de ediciones: aulas que INICIAN en la semana ISO pedida, con su
// cronograma S1..Sn derivado + overrides de gestion (estado / reprogramacion).
export async function editionWeeklyControl ({ year, week } = {}) {
  const y = Number(year)
  const w = Number(week)
  const { date_start, date_end } = isoWeekRange(y, w)
  const [rows, catalog] = await Promise.all([
    repo.weeklyControlEditions(date_start, date_end),
    getCatalog()
  ])
  const controls = await repo.sessionControlsList(rows.map((r) => Number(r.edition_num_id)))
  const ctx = {
    dayCombos: catalog.we_day_combination || [],
    holidaySet: new Set((catalog.we_holiday || []).map((h) => h.variable_3).filter(Boolean)),
    controls
  }
  // La BD prefiltra por start/end + margen; aqui se afina con el cronograma
  // REAL derivado (incluye reprogramaciones): en curso = su primera sesion no
  // pasa de la semana y su ultima sesion no termino antes de la semana.
  const editions = rows
    .map((r) => buildControlRow(r, ctx))
    .filter((r) => {
      const first = r.sessions[0]
      const last = r.sessions[r.sessions.length - 1]
      return first && first.date <= date_end && last.date >= date_start
    })
  return { year: y, week: w, date_start, date_end, editions }
}

// Guarda el estado de una sesion (A/R/T, con nueva fecha si es R) y devuelve
// la fila recalculada (la R se reubica cronologicamente). Se puede
// re-reprogramar la misma sesion; cada cambio de fecha consume una de las
// MAX_EDITION_REPROS reprogramaciones del curso.
export async function editionSessionControlSave ({ edition_num_id, session_number, status, new_date, user_id } = {}) {
  if (status === 'R' && new_date) {
    const controls = await repo.sessionControlsList([Number(edition_num_id)])
    const existing = controls.find((c) => Number(c.session_number) === Number(session_number))
    const isNewEvent = String(existing?.new_date || '').slice(0, 10) !== new_date
    const total = controls.reduce((a, c) => a + reproEventsOf(c), 0)
    if (isNewEvent && total >= MAX_EDITION_REPROS) {
      const err = new Error(`El curso ya alcanzó el máximo de ${MAX_EDITION_REPROS} reprogramaciones`)
      err.statusCode = 409
      throw err
    }
  }
  await repo.sessionControlSave({ edition_num_id, session_number, status, new_date }, user_id)
  const row = await repo.controlEditionGet(edition_num_id)
  if (!row) return null
  const [controls, catalog] = await Promise.all([
    repo.sessionControlsList([Number(edition_num_id)]),
    getCatalog()
  ])
  return buildControlRow(row, {
    dayCombos: catalog.we_day_combination || [],
    holidaySet: new Set((catalog.we_holiday || []).map((h) => h.variable_3).filter(Boolean)),
    controls
  })
}

// UPDATE (simple). Inyecta edition_num_id desde id o el propio edition.
export async function editionUpdate ({ id, edition = {}, user_id = null } = {}) {
  const payloadEdition = {
    ...edition,
    edition_num_id: id || edition.edition_num_id
  }
  const rows = await repo.update(payloadEdition, user_id)
  return toUpdateDto(rows)
}

// UPDATE TREE (padre + hijos). Retorna la fila cruda del SP o el fallback.
export async function editionTreeUpdate ({ edition = {}, user_id } = {}) {
  const rows = await repo.treeUpdate(edition, user_id)
  return toSpRowOrFallback(rows)
}

// OBTENER EDICION (padre + hijos) POR ID. Retorna raw, el front mapea.
export async function editionGet ({ id } = {}) {
  const editionId = Number(id) || null
  if (!editionId) return null
  const rows = await repo.treeGet(editionId)
  return rows?.[0] || null
}

// Logs de auditoria agrupados por transaccion.
export async function auditLogsGet ({ edition_id = null, limit = 50, offset = 0 } = {}) {
  const pedition_id = edition_id ? Number(edition_id) : null
  const pLimit = Number(limit) || 50
  const pOffset = Number(offset) || 0
  const rows = await repo.auditLogsGet(pedition_id, pLimit, pOffset)
  return rows || []
}

// CALLER (combos / SearchSelect). Array directo.
export async function editionCaller (payload = {}) {
  const {
    program_version_id,
    active = null,
    cat_status_edition = null,
    q = null,
    year = null,
    month = null
  } = payload
  return repo.caller(program_version_id, active, cat_status_edition, q, month, year)
}

// CALLER de info extra por version de programa. Array directo.
export async function editionextrainfocaller (payload = {}) {
  const { program_version_id } = payload
  return repo.extraInfoCaller(program_version_id)
}

// Lista enrollments vigentes en una edicion que pasara a A5.
export async function a5PendingEnrollments ({ edition_num_id } = {}) {
  const editionId = Number(edition_num_id)
  if (!editionId) return []
  return repo.a5PendingEnrollments(editionId)
}

// Ejecuta migracion masiva + cancelacion A5 en transaccion atomica.
export async function a5MigrationExecute ({ payload = {}, user_id } = {}) {
  const rows = await repo.a5MigrationExecute(payload, user_id)
  return toA5MigrationDto(rows)
}

// Actualiza masivamente el link de WhatsApp por abreviatura + fecha de inicio.
export async function bulkUpdateWhatsapp (items) {
  let updated = 0
  const notFound = []

  for (const item of items) {
    if (!item.abbreviation || !item.start_date || !item.whatsapp_link) continue

    const isoDate = formatStartDate(item.start_date)

    const rowCount = await repo.updateWhatsappLink(
      item.whatsapp_link.trim(),
      item.abbreviation.trim(),
      isoDate
    )

    if (rowCount > 0) {
      updated += rowCount
    } else {
      notFound.push(`${item.abbreviation} - ${item.start_date}`)
    }
  }

  return { updated, not_found: notFound }
}

// Conteo de alumnos por edicion (aula).
export async function classroomMetricsList ({ edition_ids = [] } = {}) {
  const ids = (edition_ids || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return []
  return repo.classroomMetricsList(ids)
}

// Listado de alumnos matriculados (FICO-aprobados) en una edicion/aula.
export async function classroomStudentsList ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  return repo.classroomStudentsList(id)
}

// Historial del aula: alumnos que estuvieron pero ya no estan en la lista activa.
export async function classroomStudentsHistory ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  return repo.classroomStudentsHistory(id)
}

// Resumen agregado de auditoria por aula.
export async function classroomAuditSummaryList ({ edition_ids = [] } = {}) {
  const ids = (edition_ids || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return []
  return repo.classroomAuditSummaryList(ids)
}

// Carga toda la rubrica de evaluacion al docente para una edicion (aula).
export async function classroomAuditGet ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  return repo.classroomAuditGet(id)
}

// Upsert atomico de la rubrica manual de una sesion. Reemplaza criteria completo.
export async function classroomAuditSave ({ edition_id, session_number, criteria, user_id = null } = {}) {
  const { valid, eid, sn } = validateRubricParams(edition_id, session_number)
  if (!valid) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  const payload = criteria && typeof criteria === 'object' ? criteria : {}
  const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null
  const rows = await repo.classroomAuditSave(eid, sn, payload, uid)
  return { ok: true, row: rows[0] }
}

// Lista de Notas: filas guardadas de todos los alumnos de un aula.
export async function classroomGradesGet ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  return repo.classroomGradesGet(id)
}

// Lista de Notas: bulk upsert de filas editadas. Sanea cada item (clamps por
// celda) y recalcula los totales server-side con las sesiones del aula: el
// cliente nunca dicta la nota final, solo los puntajes crudos.
export async function classroomGradesSave ({ edition_id, items = [], user_id = null } = {}) {
  const eid = Number(edition_id)
  if (!Number.isFinite(eid)) {
    return { ok: false, message: 'edition_id invalido' }
  }
  const list = Array.isArray(items) ? items : []
  const clean = list
    .map((it) => sanitizeGradeItem(it))
    .filter((it) => Number.isFinite(it.enrollment_id) && it.enrollment_id > 0)
  if (!clean.length) {
    return { ok: false, message: 'Sin filas validas para guardar' }
  }

  const sessionsTotal = Number(await repo.editionSessionsGet(eid)) || 0
  const withTotals = clean.map((it) => ({ ...it, ...computeGradeTotals(it, sessionsTotal) }))
  // user_id == null debe quedar NULL: Number(null) es 0 y violaria la FK.
  const uid = user_id != null && Number.isFinite(Number(user_id)) ? Number(user_id) : null

  // Entregables grupales (espejo de sp_nexus_aula_notas_save): si el parcial o
  // final de un alumno con grupo CAMBIA respecto a lo guardado, se propaga el
  // mismo bloque a todo el grupo; cada miembro conserva sus tests/participacion
  // y su nota final se recalcula con ellos.
  const existing = await repo.classroomGradesGet(eid)
  const existingMap = new Map(existing.map((g) => [Number(g.enrollment_id), g]))
  const sameBlock = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})
  const groupOf = (it) => it.group_number ?? existingMap.get(it.enrollment_id)?.group_number ?? null

  const groupBlocks = new Map() // grupo -> bloques que cambiaron (ultimo gana)
  for (const it of withTotals) {
    const grupo = groupOf(it)
    if (!grupo) continue
    const prev = existingMap.get(it.enrollment_id)
    const cambios = {}
    if (!sameBlock(it.partial_criteria, prev?.partial_criteria)) cambios.partial_criteria = it.partial_criteria
    if (!sameBlock(it.final_criteria, prev?.final_criteria)) cambios.final_criteria = it.final_criteria
    if (Object.keys(cambios).length) groupBlocks.set(grupo, { ...groupBlocks.get(grupo), ...cambios })
  }

  if (groupBlocks.size) {
    // Miembros presentes en el payload: se sobrescriben sus bloques
    for (const it of withTotals) {
      const blocks = groupBlocks.get(groupOf(it))
      if (!blocks) continue
      Object.assign(it, blocks, computeGradeTotals({ ...it, ...blocks }, sessionsTotal))
    }
    // Miembros del grupo ya guardados que no vienen en el payload
    const inPayload = new Set(withTotals.map((it) => it.enrollment_id))
    for (const g of existing) {
      if (inPayload.has(Number(g.enrollment_id))) continue
      const blocks = g.group_number ? groupBlocks.get(g.group_number) : null
      if (!blocks) continue
      const item = sanitizeGradeItem({ ...g, ...blocks })
      withTotals.push({ ...item, ...computeGradeTotals(item, sessionsTotal) })
    }
  }

  const saved = await repo.classroomGradesSaveBulk(eid, withTotals, uid)
  return { ok: true, data: saved }
}

// Llama al Ollama local (OpenAI-compatible) y devuelve el texto. El modelo
// corre detras de un tunel SSH en loopback; timeout corto porque un 7B
// responde en segundos o no va a responder.
async function ollamaChat (baseUrl, model, system, user, timeoutMs = 30000) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 220,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) {
    throw new Error(`Ollama respondio ${res.status}`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text || !String(text).trim()) throw new Error('Ollama devolvio respuesta vacia')
  return String(text).trim()
}

// "Tiene notas registradas" = existe al menos una celda escrita (un 0 tecleado
// CUENTA como nota: el alumno fue evaluado con 0). Distinto de celdas vacias.
function hasRegisteredGrades (item) {
  const hasNum = (obj) => Object.values(obj || {}).some((v) => v !== null && v !== undefined)
  return hasNum(item.tests) ||
    Object.values(item.participation || {}).some((v) => v === true) ||
    hasNum(item.partial_criteria) ||
    hasNum(item.final_criteria)
}

// Genera borradores de observacion por alumno (y resumen del aula) con el
// modelo local. NO persiste nada: el frontend coloca los textos en el draft y
// se guardan con el flujo normal (el humano siempre revisa antes).
// enrollment_ids opcional: regenerar solo esos alumnos (sin resumen de aula).
export async function classroomGradesObservations ({ edition_id, enrollment_ids = null } = {}) {
  const eid = Number(edition_id)
  if (!Number.isFinite(eid)) {
    return { ok: false, message: 'edition_id invalido' }
  }

  let baseUrl
  try {
    baseUrl = resolveOllamaUrl()
  } catch (err) {
    return { ok: false, message: err.message }
  }
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'

  const [students, grades, sessions] = await Promise.all([
    repo.classroomStudentsList(eid),
    repo.classroomGradesGet(eid),
    repo.editionSessionsGet(eid)
  ])
  const sessionsTotal = Number(sessions) || 0
  const gradesMap = new Map(grades.map((g) => [g.enrollment_id, g]))

  const wanted = Array.isArray(enrollment_ids) && enrollment_ids.length
    ? new Set(enrollment_ids.map(Number))
    : null
  const targets = students.filter((s) => !wanted || wanted.has(Number(s.enrollment_id)))
  if (!targets.length) {
    return { ok: false, message: 'Sin alumnos para generar observaciones' }
  }

  // Concurrencia limitada: un 7B local atiende pocas requests a la vez y el
  // tunel agrega latencia; 4 en paralelo equilibra tiempo total y estabilidad.
  const CONCURRENCY = 4
  const items = []
  const errors = []
  let cursor = 0
  async function worker () {
    while (cursor < targets.length) {
      const s = targets[cursor++]
      const g = gradesMap.get(s.enrollment_id) || {}
      const item = sanitizeGradeItem({ ...g, enrollment_id: s.enrollment_id })
      const totals = computeGradeTotals(item, sessionsTotal)
      if (!hasRegisteredGrades(item)) {
        items.push({ enrollment_id: s.enrollment_id, observation: OBS_SIN_NOTAS })
        continue
      }
      try {
        const { system, user } = buildObservationPrompt(item, totals, sessionsTotal)
        const text = await ollamaChat(baseUrl, model, system, user)
        items.push({ enrollment_id: s.enrollment_id, observation: text })
      } catch (err) {
        errors.push({ enrollment_id: s.enrollment_id, message: err.message })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))

  if (!items.length) {
    return {
      ok: false,
      message: `IA local no disponible (${errors[0]?.message || 'sin respuesta'}). Verifica el tunel a Ollama.`
    }
  }

  // Resumen del aula solo en la generacion completa (no al regenerar uno).
  let aulaSummary = null
  if (!wanted) {
    try {
      const flex = students.filter((s) => s.modality_alias === 'we_insc_modality_flexible').length
      const withFinals = students
        .map((s) => {
          const g = gradesMap.get(s.enrollment_id)
          const item = sanitizeGradeItem({ ...(g || {}), enrollment_id: s.enrollment_id })
          const totals = computeGradeTotals(item, sessionsTotal)
          return hasRegisteredGrades(item) ? { name: s.full_name, final: totals.final_grade } : null
        })
        .filter(Boolean)
        .sort((a, b) => b.final - a.final)
      const approved = withFinals.filter((x) => x.final >= GRADE_RULES.PASS_THRESHOLD).length
      const { system, user } = buildAulaSummaryPrompt({
        total: students.length,
        regular: students.length - flex,
        flex,
        approved,
        failed: students.length - approved,
        ungraded: students.length - withFinals.length,
        average: withFinals.length
          ? Math.round(withFinals.reduce((a, x) => a + x.final, 0) / withFinals.length * 100) / 100
          : null,
        top: withFinals.slice(0, 3)
      })
      aulaSummary = await ollamaChat(baseUrl, model, system, user)
    } catch (err) {
      // El resumen es secundario: si falla, igual devolvemos las observaciones.
      console.warn('[gradesObservations] resumen de aula fallo:', err.message)
    }
  }

  return { ok: true, data: { items, aula_summary: aulaSummary, errors } }
}

// Proxy del analisis IA: reenvia transcript + imagen al sidecar FastAPI y
// persiste el reporte en la fila (edicion, sesion). La URL del sidecar se
// resuelve en la primera llamada (no en import-time) para no tumbar el arranque
// del proceso si el host configurado no esta permitido.
export async function classroomAuditRunAi ({
  edition_id, session_number, transcript_text, syllabus_image, syllabus_filename
} = {}) {
  const { valid, eid, sn } = validateRubricParams(edition_id, session_number)
  if (!valid) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  if (!transcript_text || !String(transcript_text).trim()) {
    return { ok: false, message: 'transcript_text vacio' }
  }
  if (!syllabus_image) {
    return { ok: false, message: 'Falta imagen del syllabus' }
  }

  const aiAuditorUrl = resolveAiAuditorUrl()

  // FormData nativa en Node 18+: el proxy reenvia el multipart al FastAPI sin
  // descomprimir/recomprimir; lo unico que paga es el TCP loopback.
  const form = new FormData()
  form.append('sesion_numero', String(sn))
  form.append('transcript_text', String(transcript_text))
  const blob = new Blob([syllabus_image], { type: 'application/octet-stream' })
  form.append('syllabus_image', blob, syllabus_filename || 'syllabus.png')

  // 10 min de timeout: Gemini con AFC puede iterar hasta 10 veces para
  // auto-corregir. Sin AbortController el fetch nativo de Node no tiene timeout
  // y la conexion queda colgada si Gemini muere a media respuesta.
  const aiController = new AbortController()
  const aiTimeoutId = setTimeout(() => aiController.abort(), 10 * 60 * 1000)

  let aiJson
  try {
    const resp = await fetch(`${aiAuditorUrl}/api/audit`, {
      method: 'POST',
      body: form,
      signal: aiController.signal
    })
    const text = await resp.text()
    if (!resp.ok) {
      let detail = text.slice(0, 400)
      try {
        const parsed = JSON.parse(text)
        const tb = Array.isArray(parsed.traceback) ? parsed.traceback.join(' | ') : ''
        detail = `${parsed.error || ''}: ${parsed.message || parsed.detail || text}${tb ? ' || ' + tb : ''}`.slice(0, 800)
      } catch { /* no es JSON, usar text crudo */ }
      return { ok: false, message: `IA respondio ${resp.status}: ${detail}` }
    }
    aiJson = JSON.parse(text)
  } catch (err) {
    const isAbort = err?.name === 'AbortError'
    return {
      ok: false,
      message: isAbort
        ? 'La IA tardo mas de 10 min en responder. Reintenta con un transcript mas corto o revisa que Gemini este disponible.'
        : `No se pudo contactar al servicio IA (${aiAuditorUrl}). Verifica que el FastAPI este corriendo (npm run ai:start). Detalle: ${err.message}`
    }
  } finally {
    clearTimeout(aiTimeoutId)
  }

  const report = aiJson?.report || null
  const metadata = aiJson?.metadata || null
  if (!report) return { ok: false, message: 'La IA no devolvio reporte' }

  const rows = await repo.classroomAuditUpsertAi(eid, sn, report, metadata)
  return { ok: true, row: rows[0] }
}

