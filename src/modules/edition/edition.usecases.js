import { editionRepository } from './edition.repository.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'
import odooClient from '../../config/odooClient.js'
import { buildPresentialCourseName } from '../fico/odoo-sync/odoo-sync.entity.js'
// La cancelacion A5 reprograma con el MISMO motor que usa FICO: un solo RP en
// todo el sistema. El bootstrap cablea logAudit (sin el, el RP corre sin dejar
// bitacora y no avisa, ver enrollment.repository.js:26); es idempotente.
import '../fico/fico.bootstrap.js'
import { reprogramEdition } from '../fico/enrollment/enrollment.usecases.js'
import { handleSpResponse } from '../../utils/dbResponse.js'
import { getCatalog } from '../catalog/catalog.usecases.js'
import {
  buildEditionFilters,
  buildEditionByWeekFilters,
  isoWeekRange,
  buildWeeklySessionDays,
  buildControlRow,
  attachSessionAudits,
  buildSessionSchedule,
  getAllowedDays,
  b2bAttendanceSummary,
  B2B_ATTENDANCE_STATES,
  B2B_JUSTIFICATION_MAX,
  reproEventsOf,
  MAX_EDITION_REPROS,
  buildA5Payload,
  buildA5MigrationPlan,
  validateRubricParams,
  resolveAiAuditorUrl,
  formatStartDate,
  sanitizeGradeItem,
  computeGradeTotals,
  resolveOllamaUrl,
  buildObservationPrompt,
  buildAulaSummaryPrompt,
  buildReportRecommendationsPrompt,
  parseReportRecommendations,
  OBS_SIN_NOTAS,
  GRADE_RULES
} from './edition.entity.js'
import {
  toSpRowOrFallback,
  toListDto,
  toByWeekDto,
  toUpdateDto
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
    // consultas (leads en los 5 estados de LEAD_STATUSES_CONSULTA)
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

// Seguimiento Docentes (Reporte Academico): mismo cronograma derivado del
// Control de Ediciones — S1..Sn con reprogramaciones — pero para un rango
// libre de fechas y con la nota de auditoria de cada sesion pegada encima.
// Responde "que sesion de que aula llego con auditoria", que es lo que el
// agregado por aula del reporte no puede decir.
export async function editionTeacherFollowup ({ date_start, date_end } = {}) {
  const [rows, catalog] = await Promise.all([
    repo.weeklyControlEditions(date_start, date_end),
    getCatalog()
  ])
  const ids = rows.map((r) => Number(r.edition_num_id))
  const [controls, audits] = await Promise.all([
    repo.sessionControlsList(ids),
    repo.classroomAuditSessionsList(ids)
  ])
  const ctx = {
    dayCombos: catalog.we_day_combination || [],
    holidaySet: new Set((catalog.we_holiday || []).map((h) => h.variable_3).filter(Boolean)),
    controls
  }
  const editions = rows.map((r) => attachSessionAudits(buildControlRow(r, ctx), audits))
  return { date_start, date_end, editions }
}

// Guarda el estado de una sesion (A/R/T, con nueva fecha si es R) y devuelve
// la fila recalculada (una R corre las sesiones siguientes). Se puede
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

// Una edicion NO se cancela (A5) con alumnos vivos adentro: primero hay que
// reubicarlos con a5MigrationExecute. Va en el backend y no solo en el modal
// porque el modal ya fallo una vez: cuando no pudo cargar la lista de alumnos
// mostro "sin alumnos" y dejo cancelar igual. El resultado fueron ediciones
// canceladas con sus hijos todavia inflando el AULA de otros cursos, y encima
// invisibles (el cronograma oculta las filas A5).
// Lo que se bloquea es CANCELAR, no editar: si la edicion ya estaba en A5 el
// guardado sigue pasando (cambiar docente u horario de una edicion cancelada es
// legitimo, y hay ediciones A5 viejas con alumnos vivos que igual hay que poder
// tocar). Solo se frena la TRANSICION hacia A5.
async function assertSinAlumnosVivos (editionId, segmentId) {
  if (!editionId || !segmentId) return
  const a5Id = await repo.a5SegmentId()
  if (!a5Id || Number(segmentId) !== Number(a5Id)) return
  if (Number(await repo.getSegment(Number(editionId))) === Number(a5Id)) return

  const pendientes = await repo.a5PendingEnrollments(Number(editionId))
  if (pendientes.length === 0) return
  throw new DomainError(
    `No se puede cancelar (A5): la edicion tiene ${pendientes.length} inscripcion(es) vigente(s). ` +
    'Reubicalas primero desde el modal de cancelacion.'
  )
}

// UPDATE (simple). Inyecta edition_num_id desde id o el propio edition.
export async function editionUpdate ({ id, edition = {}, user_id = null } = {}) {
  const payloadEdition = {
    ...edition,
    edition_num_id: id || edition.edition_num_id
  }
  await assertSinAlumnosVivos(payloadEdition.edition_num_id, edition.cat_segment_id)
  const rows = await repo.update(payloadEdition, user_id)
  return toUpdateDto(rows)
}

// UPDATE TREE (padre + hijos). Retorna la fila cruda del SP o el fallback.
export async function editionTreeUpdate ({ edition = {}, user_id } = {}) {
  await assertSinAlumnosVivos(edition.edition_id, edition.cat_segment_id)
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

// ── LINKS DEL AULA POR EDICION ─────────────────────────────────────────────
// Los edita Academica en linea desde Producto > Cronograma.
//
// Endpoint propio y no sp_edition_update por dos razones: ese SP reescribe la
// edicion entera (fechas, docente, codigos) y exige rol ADMIN o PRODUCTO, asi
// que darle acceso a Academica para que pegue un link le abriria todo lo demas.
// Aca el SET no puede tocar nada fuera de esta lista.
const CLASSROOM_LINK_FIELDS = ['whatsapp_link', 'teams_link', 'ficha_link', 'grades_link']

export async function classroomLinksSave (payload = {}) {
  const editionId = Number(payload.edition_num_id) || null
  if (!editionId) throw new DomainError('Falta edition_num_id', { statusCode: 400 })

  // Cadena vacia -> NULL: "sin link" es NULL en toda la app (el chip lo pinta
  // apagado y el correo omite el bloque). Una clave ausente no se toca.
  const fields = {}
  for (const name of CLASSROOM_LINK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, name)) continue
    const raw = payload[name]
    fields[name] = raw == null || String(raw).trim() === '' ? null : String(raw).trim()
  }
  if (!Object.keys(fields).length) return { updated: 0 }

  const updated = await withMissingColumnHint(() => repo.updateEditionColumns(editionId, fields))
  return { updated }
}

// ── RECURSOS DE EVENTO POR EDICION ─────────────────────────────────────────
// Whitelist explicita: es lo unico que puede llegar al SET del UPDATE.
const EVENT_RESOURCE_FIELDS = [
  'banner_image',
  'banner_mime',
  'banner_link',
  'whatsapp_link',
  'certificate_form_link',
  'business_card_link',
  'session_detail_virtual',
  'session_detail_onsite'
]

// Tope del banner. El correo lo lleva incrustado, asi que su peso se multiplica
// por cada asistente: 2 MB x 800 inscritos serian 1.6 GB de salida.
const MAX_BANNER_BYTES = 2 * 1024 * 1024
const ALLOWED_BANNER_MIMES = ['image/jpeg', 'image/png']

// Las columnas de recursos las crea Backend/scripts/add-event-edition-resources.sql,
// que se corre a mano. Si falta, Postgres tira 42703 (undefined_column) y el
// error handler global lo enmascara como "Error interno" en produccion: el
// modulo entero parece vacio y nadie sabe por que. Se traduce a un mensaje que
// dice exactamente que falta.
async function withMissingColumnHint (fn) {
  try {
    return await fn()
  } catch (err) {
    if (err?.code === '42703') {
      throw new DomainError(
        'Faltan columnas de program_editions en la base de datos. Corre ' +
        'Backend/scripts/add-event-edition-resources.sql (recursos de evento) o ' +
        'Backend/scripts/add-edition-classroom-links.mjs (links del aula).',
        { statusCode: 503, code: 'EDITION_COLUMNS_SCHEMA_MISSING' }
      )
    }
    throw err
  }
}

export async function eventResourcesGet ({ edition_num_id } = {}) {
  const editionId = Number(edition_num_id) || null
  if (!editionId) return null
  return withMissingColumnHint(() => repo.getEventResources(editionId))
}

// Selector del modulo de Eventos (Fundacion).
export async function eventEditionsList ({ q = null } = {}) {
  const search = q && String(q).trim() ? String(q).trim() : null
  const items = await withMissingColumnHint(() => repo.listEventEditions(search))
  return { items }
}

// ── OBJETIVOS DEL EVENTO (Fundacion > Objetivos) ────────────────────────
//
// El catalogo de areas es fijo y vive aqui, no en la BD: son las cajas del
// organigrama de ventas, no data. El codigo ('1.1') es la llave con la que se
// guarda el objetivo en channel_goals, asi que renombrar un area es gratis
// pero cambiarle el codigo pierde su meta.
const REPORT_AREAS = [
  { code: '1.1', name: 'Comercial' },
  { code: '1.2', name: 'Marketing' },
  { code: '1.3', name: 'Web' },
  { code: '1.4', name: 'B2B' },
  { code: '1.5', name: 'Fundación WE' },
  { code: '1.6', name: 'Otros' },
  { code: '1.7', name: 'Members' },
  // Los ponentes no son un canal de venta: no pagan entrada y no vienen de un
  // lead. Van en fila aparte para que el avance de las areas no los cuente
  // como ventas, pero suman en la columna VIP (ver AREA_CASE del repository).
  { code: '1.8', name: 'Ponentes' }
]

const MODALIDAD_KEYS = ['vip', 'premium', 'general', 'virtual']

function emptyRow (code, name) {
  return { code, name, avance: 0, vip: 0, premium: 0, general: 0, virtual: 0, sin_categoria: 0, consultas: 0 }
}

function addInto (row, src) {
  row.avance += Number(src.avance) || 0
  row.sin_categoria += Number(src.sin_categoria) || 0
  for (const k of MODALIDAD_KEYS) row[k] += Number(src[k]) || 0
}

export async function eventGoalsReport ({ edition_num_id } = {}) {
  const editionId = Number(edition_num_id) || null
  if (!editionId) return null

  return withMissingColumnHint(async () => {
    const [areasRaw, leadsRaw, categorias, goals] = await Promise.all([
      repo.eventReportAreas(editionId),
      repo.eventReportLeads(editionId),
      repo.eventReportCategories(editionId),
      repo.eventGoalsGet(editionId)
    ])

    const byCode = new Map(REPORT_AREAS.map(a => [a.code, emptyRow(a.code, a.name)]))
    // Members se abre por tier. Los hijos salen de la data (solo aparece el
    // tier que compro alguien), no de una lista fija que quedaria en ceros.
    const membersChildren = new Map()

    for (const r of areasRaw) {
      const row = byCode.get(r.area_code)
      if (!row) continue
      addInto(row, r)
      if (r.area_code === '1.7' && r.tier) {
        const key = String(r.tier)
        if (!membersChildren.has(key)) {
          membersChildren.set(key, emptyRow(`1.7.${key}`, r.tier_name || `Tier ${key}`))
        }
        addInto(membersChildren.get(key), r)
      }
    }

    for (const r of leadsRaw) {
      const row = byCode.get(r.area_code)
      if (row) row.consultas = Number(r.consultas) || 0
    }

    const areas = REPORT_AREAS.map(a => {
      const row = byCode.get(a.code)
      if (a.code === '1.7' && membersChildren.size) {
        row.children = [...membersChildren.values()].sort((x, y) => x.name.localeCompare(y.name))
      }
      return row
    })

    // Modalidades que de verdad se venden. Sin configuracion de precios se
    // muestran las cuatro: es preferible una columna vacia a esconder ventas.
    const modalidades = categorias.length
      ? categorias.map(c => ({ key: String(c.alias).replace('we_event_category_', ''), label: c.description, catalog_id: c.catalog_id }))
      : MODALIDAD_KEYS.map(k => ({ key: k, label: k.toUpperCase(), catalog_id: null }))

    return {
      areas,
      // Orden de negocio (VIP primero), no el del catalogo: el cuadro que
      // llena Fundacion se lee de arriba abajo en ese orden.
      modalidades: modalidades
        .filter(m => MODALIDAD_KEYS.includes(m.key))
        .sort((a, b) => MODALIDAD_KEYS.indexOf(a.key) - MODALIDAD_KEYS.indexOf(b.key)),
      goals: goals || {},
      leads_total: areas.reduce((acc, a) => acc + a.consultas, 0),
      avance_total: areas.reduce((acc, a) => acc + a.avance, 0)
    }
  })
}

// El objetivo lo tipea Fundacion. Se guarda saneado: solo areas conocidas,
// solo modalidades conocidas, solo enteros >= 0. Sin esto el jsonb termina
// guardando cualquier cosa que mande el cliente.
export async function eventGoalsSave ({ edition_num_id, goals = {}, user_id = null } = {}) {
  const editionId = Number(edition_num_id) || null
  if (!editionId) return { goals: {} }

  const validCodes = new Set(REPORT_AREAS.map(a => a.code))
  const clean = {}
  for (const [code, row] of Object.entries(goals || {})) {
    if (!validCodes.has(code) || !row || typeof row !== 'object') continue
    const cell = {}
    for (const k of MODALIDAD_KEYS) {
      const n = Math.trunc(Number(row[k]))
      if (Number.isFinite(n) && n > 0) cell[k] = n
    }
    if (Object.keys(cell).length) clean[code] = cell
  }

  return withMissingColumnHint(async () => ({ goals: await repo.eventGoalsSave(editionId, clean, user_id) }))
}

// ── CATEGORIAS DE ENTRADA DEL EVENTO ────────────────────────────────────
// Que categorias se venden (no todos los congresos tienen las cuatro), su
// tarifa y el grupo de WhatsApp de cada una.

export async function eventCategoriesGet ({ edition_num_id } = {}) {
  const editionId = Number(edition_num_id) || null
  if (!editionId) return { program_version_id: null, items: [] }
  return withMissingColumnHint(async () => {
    const versionId = await repo.getEventProgramVersion(editionId)
    if (!versionId) return { program_version_id: null, items: [] }
    return { program_version_id: versionId, items: await repo.getEventCategories(versionId) }
  })
}

function toAmount (value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function eventCategoriesSave ({ edition_num_id, categories = [] } = {}) {
  const editionId = Number(edition_num_id) || null
  if (!editionId) return { updated: 0 }

  return withMissingColumnHint(async () => {
    const versionId = await repo.getEventProgramVersion(editionId)
    if (!versionId) throw new NotFoundError('La edicion no existe')

    // El cliente manda catalog_ids. Se cotejan contra las categorias reales del
    // catalogo en vez de confiar en el numero que llego: sin esto el endpoint
    // escribe filas contra cualquier catalog_id del sistema.
    const valid = new Set((await repo.getEventCategories(versionId)).map(c => c.cat_event_category))

    const clean = []
    for (const raw of categories) {
      const id = Number(raw?.cat_event_category) || null
      if (!id || !valid.has(id)) continue
      const link = raw.whatsapp_link == null ? '' : String(raw.whatsapp_link).trim()
      clean.push({
        cat_event_category: id,
        enabled: !!raw.enabled,
        price_student_soles: toAmount(raw.price_student_soles),
        price_student_dollars: toAmount(raw.price_student_dollars),
        price_profesional_soles: toAmount(raw.price_profesional_soles),
        price_profesional_dollars: toAmount(raw.price_profesional_dollars),
        whatsapp_link: link || null
      })
    }
    if (!clean.length) return { updated: 0 }

    // Un evento sin ninguna categoria encendida vuelve al fallback de "las
    // cuatro" en el formulario de leads, que no es lo que el usuario quiso.
    if (!clean.some(c => c.enabled)) {
      throw new DomainError('Deja al menos una categoria de entrada activa', { statusCode: 400 })
    }

    const updated = await repo.saveEventCategories(versionId, clean)
    return { updated }
  })
}

// Devuelve el banner como data URI para previsualizarlo en el modal.
export async function eventBannerGet ({ edition_num_id } = {}) {
  const editionId = Number(edition_num_id) || null
  if (!editionId) return null
  const row = await withMissingColumnHint(() => repo.getEventBannerImage(editionId))
  if (!row?.banner_image) return null
  const buffer = Buffer.isBuffer(row.banner_image) ? row.banner_image : Buffer.from(row.banner_image)
  return { data_url: `data:${row.banner_mime || 'image/jpeg'};base64,${buffer.toString('base64')}` }
}

export async function eventResourcesSave (payload = {}) {
  const editionId = Number(payload.edition_num_id) || null
  if (!editionId) return { updated: 0 }

  // Cadena vacia -> NULL: el correo distingue "sin cargar" (omite el bloque) de
  // un string vacio, y COALESCE/NULLIF aguas abajo esperan NULL.
  const fields = {}
  for (const name of EVENT_RESOURCE_FIELDS) {
    if (name === 'banner_image' || name === 'banner_mime') continue
    if (!Object.prototype.hasOwnProperty.call(payload, name)) continue
    const raw = payload[name]
    fields[name] = raw == null || String(raw).trim() === '' ? null : String(raw).trim()
  }

  // El banner llega en base64 dentro del JSON. Se acepta null explicito para
  // borrarlo; si no viene la clave, no se toca lo ya guardado.
  if (Object.prototype.hasOwnProperty.call(payload, 'banner_image_base64')) {
    const b64 = payload.banner_image_base64
    if (b64 == null || String(b64).trim() === '') {
      fields.banner_image = null
      fields.banner_mime = null
    } else {
      const mime = String(payload.banner_mime || '').toLowerCase()
      if (!ALLOWED_BANNER_MIMES.includes(mime)) {
        throw new DomainError('El banner debe ser JPG o PNG', { statusCode: 400 })
      }
      const buffer = Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64')
      if (!buffer.length) throw new DomainError('El banner llego vacio', { statusCode: 400 })
      if (buffer.length > MAX_BANNER_BYTES) {
        throw new DomainError('El banner supera 2 MB. Comprimelo antes de subirlo.', { statusCode: 400 })
      }
      fields.banner_image = buffer
      fields.banner_mime = mime
    }
  }

  const updated = await withMissingColumnHint(() => repo.updateEditionColumns(editionId, fields))
  return { updated }
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

// Migracion A5 = reprogramar (RP) cada alumno vivo a la edicion que eligio
// Producto y RECIEN ENTONCES cancelar la edicion.
//
// Reusa reprogramEdition de FICO en vez de tener un segundo motor de RP: el
// origen queda RP conservando lo pagado, el destino nace ACT con sus hijos SEG,
// y Odoo + correo salen por la cola. Un modulo SEG tambien se puede migrar: el
// RP le conserva el parent_enrollment_id (enrollment.entity.js:307).
//
// Falla CERRADO: si queda una sola inscripcion sin destino, no se migra nada y
// la edicion no se cancela. Cancelar dejando alumnos atras es exactamente el bug
// que este flujo existe para evitar.
export async function a5MigrationExecute ({ payload = {}, user_id } = {}) {
  const { valid, editionId } = buildA5Payload(payload)
  if (!valid) throw new DomainError('Migracion A5 invalida: falta la edicion o la lista de migraciones')

  const justificacion = String(payload.justificacion || '').trim()
  if (!justificacion) throw new DomainError('La justificacion es obligatoria')

  const pending = await repo.a5PendingEnrollments(editionId)
  const { valid: planValido, sinDestino, plan } = buildA5MigrationPlan(pending, payload.migrations)
  if (!planValido) {
    throw new DomainError(
      `Faltan ${sinDestino.length} inscripcion(es) por asignar a una edicion destino`
    )
  }

  const migradas = []
  const fallidas = []
  for (const { enrollmentId, targetEditionId } of plan) {
    try {
      await reprogramEdition({
        enrollmentId,
        newEditionId: targetEditionId,
        justificacion,
        userId: user_id
      })
      migradas.push(enrollmentId)
    } catch (err) {
      fallidas.push(`#${enrollmentId}: ${err.message}`)
    }
  }

  // Un RP ya ejecutado no se deshace (Odoo y correo ya salieron), asi que las
  // migradas quedan migradas. Lo que NO se hace es cancelar la edicion: sigue
  // visible en el cronograma con los que faltan, y se reintenta sobre esos.
  if (fallidas.length > 0) {
    throw new DomainError(
      `Migracion incompleta: ${migradas.length} ok, ${fallidas.length} con error. ` +
      `La edicion NO se cancelo. Detalle: ${fallidas.join(' | ')}`
    )
  }

  const segmentId = payload.a5_segment_id || await repo.a5SegmentId()
  if (!segmentId) throw new DomainError('No se encontro el segmento A5 en el catalogo')
  await repo.setSegment(editionId, segmentId)

  return {
    result: 1,
    message: `Edicion cancelada (A5). ${migradas.length} inscripcion(es) reprogramada(s).`,
    migrated_count: migradas.length
  }
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

// Tab Historial del aula. Dos grupos que NO son lo mismo y por eso viajan
// separados: `left` = estuvieron matriculados y salieron (retiro/CC/RP/baja);
// `validated` = nunca van a asistir porque el modulo se les convalido.
export async function classroomStudentsHistory ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return { left: [], validated: [] }
  const [left, validated] = await Promise.all([
    repo.classroomStudentsHistory(id),
    repo.classroomValidatedList(id)
  ])
  return { left, validated }
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

// Certificar aula en Odoo: aplica las notas del ERP a slide.group.evaluation y
// corre el proceso de certificación masiva (cargar → filtrar aprobados →
// procesar → generar PDFs). Mapeo: Examen Parcial = partial_score, Examen
// Final = final_deliv_score, Promedio final = final_grade, Participación =
// nº de checks. Odoo decide quién aprueba con su propio filtro.
export async function classroomOdooCertify ({ edition_id } = {}) {
  const eid = Number(edition_id)
  if (!Number.isFinite(eid)) return { ok: false, message: 'edition_id invalido' }

  const rows = await repo.classroomOdooCertifyData(eid)
  if (!rows.length) return { ok: false, message: 'Edición no encontrada' }

  const { odoo_activation: odooActivation, start_date: startDate } = rows[0]
  if (!odooActivation?.trim()) return { ok: false, message: 'El programa no tiene configurado odoo_activation' }
  if (!startDate) return { ok: false, message: 'La edición no tiene fecha de inicio' }
  const groupName = buildPresentialCourseName({ odooActivation: odooActivation.trim(), startDate })

  const grades = []
  let withoutGrades = 0
  for (const r of rows) {
    if (!r.enrollment_id) continue
    const name = [r.last_name, r.first_name].filter(Boolean).join(' ') || `enrollment ${r.enrollment_id}`
    if (r.final_grade == null) { withoutGrades++; continue }
    const participationChecks = Object.values(r.participation || {}).filter(Boolean).length
    grades.push({
      enrollment_id:   r.enrollment_id,
      // sin odoo_student_id igual entra: certifyClassroom lo resuelve por nombre
      odoo_student_id: r.odoo_student_id || null,
      student_name:    name,
      first_name:      r.first_name || '',
      last_name:       r.last_name || '',
      // con deuda: notas sí, certificado no (hasta que pague)
      has_debt:        Number(r.fin_overdue) > 0,
      midterm:         Number(r.partial_score) || 0,
      final:           Number(r.final_deliv_score) || 0,
      participation:   participationChecks,
      final_score:     Number(r.final_grade) || 0
    })
  }
  if (!grades.length) return { ok: false, message: 'Ningún alumno tiene notas guardadas en el ERP' }

  const result = await odooClient.certifyClassroom({ groupName, grades })
  if (!result.success) return { ok: false, message: result.error }

  // Backfill: los matcheados por nombre quedan vinculados para siempre.
  if (result.resolved_by_name?.length) {
    await repo.backfillOdooStudentIds(result.resolved_by_name)
  }
  // Marca los certificados emitidos en la fila de notas (columna Cert. del aula).
  if (result.certified?.length) {
    await repo.saveCertCodes(result.certified)
  }

  return {
    ok: true,
    data: {
      group_name: groupName,
      students_without_grades: withoutGrades,
      students_with_debt: grades.filter(g => g.has_debt).map(g => g.student_name),
      ...result
    }
  }
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

// Datos de Reporte Academico / Aulas en una sola consulta ligera (ver
// repository). Con edition_id devuelve solo esa aula (header de AulaDetail).
export async function academicReport ({ edition_id } = {}) {
  const eid = Number(edition_id)
  return repo.academicReportList({ editionId: Number.isFinite(eid) && eid > 0 ? eid : null })
}

// Recomendaciones del Reporte Academico con la IA local (la misma que redacta
// las observaciones de notas). El frontend manda el snapshot de indicadores ya
// calculados; el modelo solo redacta. Dos intentos porque un 7B a veces rompe
// el JSON; si ambos fallan el frontend cae a sus cartas heuristicas.
export async function reportRecommendations ({ snapshot } = {}) {
  let baseUrl
  try {
    baseUrl = resolveOllamaUrl()
  } catch (err) {
    return { ok: false, message: err.message }
  }

  // Fail-fast: ping barato antes de comprometer al modelo. Con el tunel caido
  // la request muere en ~2s en vez de colgarse 2 minutos entre reintentos.
  try {
    const ping = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) })
    if (!ping.ok) throw new Error(`status ${ping.status}`)
  } catch (err) {
    return { ok: false, message: `IA local no disponible (${err.message}). Verifica el tunel a Ollama.` }
  }

  const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'
  const { system, user } = buildReportRecommendationsPrompt(snapshot || {})

  let lastError = 'sin respuesta'
  for (let attempt = 0; attempt < 2; attempt++) {
    let text
    try {
      text = await ollamaChat(baseUrl, model, system, user, 45000)
    } catch (err) {
      // Error de red/timeout con el servicio ya verificado: reintentar aqui
      // solo duplica la espera. Salimos y que el frontend use su respaldo.
      lastError = err.message
      break
    }
    const items = parseReportRecommendations(text)
    if (items.length === 3) {
      return { ok: true, data: items }
    }
    // JSON invalido o incompleto: esto si merece un segundo intento.
    lastError = `respuesta con ${items.length} recomendaciones validas (se esperaban 3)`
  }
  return { ok: false, message: `IA local no disponible (${lastError}). Verifica el tunel a Ollama.` }
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


// =====================================================================
// Seguimiento B2B (Academica)
// =====================================================================

// Alumnos B2B en aulas EN VIVO, agrupados por aula, con el cronograma S1..Sn
// DERIVADO igual que Control de Ediciones (misma frecuencia, mismos feriados,
// mismas reprogramaciones) para que las fechas de asistencia cuadren con el
// dictado real. La asistencia sale de b2b_attendance; la nota final se lee de
// la Lista de Notas y no se escribe nunca desde aqui.
export async function b2bTrackingList ({ scope = 'curso' } = {}) {
  const [rows, catalog] = await Promise.all([repo.b2bTrackingList(), getCatalog()])
  if (!rows.length) return []

  const editionIds = [...new Set(rows.map((r) => Number(r.edition_num_id)))]
  const controls = await repo.sessionControlsList(editionIds)
  const dayCombos = catalog.we_day_combination || []
  const holidaySet = new Set((catalog.we_holiday || []).map((h) => h.variable_3).filter(Boolean))

  const byEdition = new Map()
  for (const r of rows) {
    const id = Number(r.edition_num_id)
    if (!byEdition.has(id)) {
      const overrides = new Map(
        controls
          .filter((c) => Number(c.program_edition_id) === id)
          .map((c) => [Number(c.session_number), {
            status: c.status || null,
            new_date: c.new_date ? String(c.new_date).slice(0, 10) : null
          }])
      )
      const sessions = buildSessionSchedule({
        startDateStr: r.start_date,
        allowedDays: getAllowedDays(dayCombos, Number(r.cat_day_combination_id), r.start_date),
        holidaySet,
        totalSessions: Number(r.total_sessions) || 0,
        overrides
      })
      byEdition.set(id, {
        edition_num_id: id,
        specific_code: r.specific_code,
        abbreviation: r.abbreviation,
        version_code: r.version_code,
        instructor: r.instructor,
        day_label: r.day_label,
        hour_label: r.hour_label,
        start_date: r.start_date,
        end_date: r.end_date,
        total_sessions: Number(r.total_sessions) || 0,
        sessions,
        students: []
      })
    }
    const ed = byEdition.get(id)
    const attendance = r.attendance || {}
    ed.students.push({
      enrollment_id: Number(r.enrollment_id),
      dni: r.dni,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      agent_origin: r.agent_origin,
      final_grade: r.final_grade === null ? null : Number(r.final_grade),
      attendance,
      attendance_notes: r.attendance_notes || {},
      attendance_updated_at: r.attendance_updated_at,
      summary: b2bAttendanceSummary(attendance, ed.total_sessions)
    })
  }

  const editions = [...byEdition.values()]
  if (scope === 'todas') return editions
  // "En curso" sobre el cronograma REAL derivado: ya empezo y aun no termina.
  const today = new Date().toISOString().slice(0, 10)
  return editions.filter((e) => {
    const first = e.sessions[0]?.date || e.start_date
    const last = e.sessions[e.sessions.length - 1]?.date || e.end_date
    return (!first || first <= today) && (!last || last >= today)
  })
}

// Marca una celda de asistencia. status null = volver a "sin marcar".
// El motivo (`note`) es obligatorio para 'J' y se descarta en los demas
// estados: una Presente con motivo de falta pegado seria basura heredada de
// un cambio de estado anterior.
export async function b2bAttendanceSave ({ enrollment_id, program_edition_id, session_number, status, note, user_id } = {}) {
  const eid = Number(enrollment_id)
  const peid = Number(program_edition_id)
  const sn = Number(session_number)
  if (!Number.isFinite(eid) || !Number.isFinite(peid) || !Number.isFinite(sn) || sn < 1) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  const st = status || null
  if (st && !B2B_ATTENDANCE_STATES.includes(st)) {
    return { ok: false, message: `Estado invalido: ${st}` }
  }
  const justification = st === 'J' ? String(note || '').trim().slice(0, B2B_JUSTIFICATION_MAX) : null
  if (st === 'J' && !justification) {
    return { ok: false, message: 'La justificacion necesita un motivo' }
  }
  const row = await repo.b2bAttendanceSave(
    { enrollment_id: eid, program_edition_id: peid, session_number: sn, status: st, note: justification },
    user_id || null
  )
  return { ok: true, data: row }
}
