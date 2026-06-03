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
