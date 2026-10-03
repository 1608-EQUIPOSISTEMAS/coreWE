// Reglas puras del dominio comercial. Sin BD, Slack ni sistema de archivos.

// Separa el centinela -1 (Vacio) del resto de IDs reales de un filtro multi
// seleccion. Devuelve los IDs limpios y un flag para incluir registros NULL.
export function splitNullSentinel (arr) {
  if (!Array.isArray(arr) || arr.length === 0) return { ids: [], includeNull: false }
  const includeNull = arr.includes(-1)
  const ids = arr.filter(id => id !== -1)
  return { ids, includeNull }
}

// Normaliza el filtro 'active' al dominio del SP ('Y' | 'N' | null).
// Booleano -> Y/N; cualquier otro valor (string, null) se deja tal cual.
export function normalizeActive (active) {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  return active
}

// Ensambla el objeto de filtros que recibe sp_comercial_lead_list, aplicando
// defaults de arrays vacios y desdoblando los centinelas -1 en flags include_null.
export function buildFilterPayload (payload = {}) {
  const {
    q = null,
    origin_seller_phone = null,
    user_id,
    page = 1,
    size = 25,
    order_by = 0,
    from_date = null,
    to_date = null,
    attempt_origin_ids,
    first_contact_from = null,
    first_contact_to = null,
    last_contact_from = null,
    last_contact_to = null,
    last_contact_empty = false,
    strategy_ids,
    word_ids,
    medium_contact_ids,
    code_country_ids,
    updated_from = null,
    updated_to = null,
    edition_start_from = null,
    edition_start_to = null,
    pay_date_from = null,
    pay_date_to = null,
    prospect_situation_ids,
    active = null,
    program_text = null,
    web = null,
    b2b = null,
    owner_user_ids,
    status_lead_ids,
    last_follow_ids,
    last_attempt_type_ids,
    interest_level_ids,
    channel_ids,
    query_ids,
    type_program_ids,
    model_modality_ids,
    program_version_ids,
    payment_channel_ids,
    moment_ids,
    membership_moment_ids,
    fico_status_ids,
    profile_ids,
    currency_ids,
    inscription_modality_ids,
    installment_status_ids,
    payment_method_ids,
    payment_type_ids,
    settlement_status_ids
  } = payload

  const activeParam = normalizeActive(active)

  const ps = splitNullSentinel(prospect_situation_ids)
  const str = splitNullSentinel(strategy_ids)
  const qry = splitNullSentinel(query_ids)
  const pv = splitNullSentinel(program_version_ids)
  const lf = splitNullSentinel(last_follow_ids)
  const mom = splitNullSentinel(moment_ids)
  const intLvl = splitNullSentinel(interest_level_ids)
  const chan = splitNullSentinel(channel_ids)
  const lat = splitNullSentinel(last_attempt_type_ids)

  return {
    current_user_id: user_id,
    q,
    origin_seller_phone,
    page,
    size,
    order_by,
    from_date,
    to_date,
    updated_from,
    updated_to,
    edition_start_from,
    edition_start_to,
    active: activeParam,
    first_contact_from,
    first_contact_to,
    // Ult. fecha de contacto = fecha del ultimo intento. 'empty' trae los leads
    // que nunca se contactaron (la columna sale '—'); con rango, se suman (OR).
    last_contact_from,
    last_contact_to,
    include_null_last_contact: last_contact_empty === true,
    program_text,
    web,
    b2b,
    pay_date_from,
    pay_date_to,

    owner_user_ids: owner_user_ids || [],
    status_lead_ids: status_lead_ids || [],
    type_program_ids: type_program_ids || [],
    model_modality_ids: model_modality_ids || [],
    membership_moment_ids: membership_moment_ids || [],
    attempt_origin_ids: attempt_origin_ids || [],
    word_ids: word_ids || [],
    medium_contact_ids: medium_contact_ids || [],
    code_country_ids: code_country_ids || [],
    fico_status_ids: fico_status_ids || [],
    profile_ids: profile_ids || [],
    currency_ids: currency_ids || [],
    inscription_modality_ids: inscription_modality_ids || [],
    installment_status_ids: installment_status_ids || [],
    payment_method_ids: payment_method_ids || [],
    payment_type_ids: payment_type_ids || [],
    settlement_status_ids: settlement_status_ids || [],
    payment_channel_ids: payment_channel_ids || [],

    prospect_situation_ids: ps.ids,
    include_null_situation: ps.includeNull,

    strategy_ids: str.ids,
    include_null_strategy: str.includeNull,

    query_ids: qry.ids,
    include_null_query: qry.includeNull,

    program_version_ids: pv.ids,
    include_null_program: pv.includeNull,

    last_follow_ids: lf.ids,
    include_null_follow: lf.includeNull,

    last_attempt_type_ids: lat.ids,
    include_null_attempt_type: lat.includeNull,

    moment_ids: mom.ids,
    include_null_moment: mom.includeNull,

    interest_level_ids: intLvl.ids,
    include_null_interest: intLvl.includeNull,

    channel_ids: chan.ids,
    include_null_channel: chan.includeNull
  }
}

// ── Unico contacto automatico (pedido de los asesores, 02/10/26) ──────────
// Un lead que ya recibio toda la secuencia de gestiones sin responder con
// interes pasa solo a "Unico contacto". Basta con que esten las 4, en cualquier
// orden (un asesor que se adelanta un paso no rompe la regla). Cierre de
// Campana NO es parte de la secuencia (corregido por el usuario 02/10/26).
export const UNIQUE_CONTACT_STATUS = 'we_lead_status_unique'
const UNIQUE_CONTACT_SEQUENCE = [
  'we_attempt_seg_1', // Seguimiento 1
  'we_attempt_call', // Llamada 1
  'we_attempt_seg_2', // Seguimiento 2
  'we_attempt_call_2' // Llamada 2
]
// Si en alguna gestion el lead mostro interes, no es "unico contacto".
const INTEREST_RESULTS = new Set([
  'we_calling_show_interest',
  'we_calling_will_pay',
  'we_calling_call_again',
  'we_calling_next_start_interest'
])
// Solo se mueve desde estados abiertos: Pagara, Pago, Inscrito, Cerrado,
// Desestimado y Anulado nunca se tocan.
const OPEN_STATUSES = new Set([
  'we_lead_status_atendido',
  'we_lead_status_interesado',
  'we_lead_status_indiferente',
  'we_lead_status_proximo'
])

// attempts = [{ type_alias, result_alias }] de lead_contact_attempts.
export function shouldMoveToUniqueContact ({ statusAlias, attempts = [] }) {
  if (!OPEN_STATUSES.has(statusAlias)) return false
  if (attempts.some(a => INTEREST_RESULTS.has(a.result_alias))) return false
  const types = new Set(attempts.map(a => a.type_alias))
  return UNIQUE_CONTACT_SEQUENCE.every(t => types.has(t))
}

// Reemplaza caracteres no seguros del nombre de archivo para persistirlo en disco.
export function sanitizeFilename (filename) {
  return String(filename).replace(/[^a-zA-Z0-9.]/g, '_')
}

// Antepone una marca de tiempo al nombre saneado para evitar colisiones.
export function buildUniqueFilename (filename, now = Date.now()) {
  return `${now}_${sanitizeFilename(filename)}`
}

// Decide, segun el alias del canal de pago, que efecto secundario disparar tras
// registrar la inscripcion: notificar Slack (web), sincronizar Sheet (general)
// o ninguno (other).
export function detectChannelAlias (alias) {
  if (alias === 'we_channel_web') return 'web'
  if (alias === 'we_channel_general') return 'general'
  return 'other'
}

// Normaliza el filtro 'active' para el listado de versiones de programa.
// Booleano -> Y/N; string -> tal cual; resto -> null.
export function normalizeActiveProgramVersion (active) {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string') return active
  return null
}

// Ensambla el objeto de filtros que recibe sp_edition_list. Los multiselect
// caen a array vacio (el SP lo trata como ausencia de filtro), los simples a null.
export function buildEditionFilterPayload (payload = {}) {
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

  const activeParam = normalizeActive(active)

  return {
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
}
