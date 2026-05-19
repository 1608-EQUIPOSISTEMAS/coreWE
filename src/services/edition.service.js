import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'


// import { handleSpResponse } from '../utils/dbResponse'
import { handleSpResponse } from '../utils/dbResponse.js'
/**
 * REGISTER (simple)
 * CALL public.sp_edition_register(p_edition jsonb, p_user_id int, p_cur refcursor)
 */
async function editionRegister ({ edition = {}, user_id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_register',
    [
      JSON.stringify(edition || {}),
      user_id
    ],
    { statementTimeoutMs: 25000 }
  )

  // Esperamos que el SP devuelva: result, response, message
  return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
}

/**
 * REGISTER TREE (padre + hijos)
 * CALL public.sp_edition_tree_register(p_edition jsonb, p_user_id int, p_cur refcursor)
 */
async function editionTreeRegister ({ edition = {}, user_id }) {

  console.log("data: ")
  console.log(user_id)

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_tree_register',
    [
      JSON.stringify(edition || {}),
      user_id
    ],
    { statementTimeoutMs: 25000 }
  );

  // AQUÍ ESTÁ LA MAGIA:
  // Si el SP devuelve error (0), handleSpResponse lanzará una excepción.
  // Si es éxito (1), retornará el objeto { result: 1, message: '...', id: ... }
  return handleSpResponse(rows);
}

/**
 * LIST
 * CALL public.sp_edition_list(p_filters jsonb, p_cur refcursor)
 */
async function editionList (payload = {}) {
  const {
    // --- Campos Simples (Se quedan en null) ---
    date_from = null,
    date_to = null,
    program_version_id = null, // Este es select simple, se queda null
    clasification = null,
    active = null,
    q = null,
    page = 1,
    size = 25,

    // --- CAMBIO AQUÍ: Campos MultiSelect (Cambiar null por []) ---
    // Al enviar [], PostgreSQL recibe un array vacío, lo procesa sin error,
    // y tu SP convertirá ese array vacío en NULL internamente para ignorar el filtro.
    instructores_seleccionados = [], 
    category_ids = [],               
    type_program_ids = [],           
    combination_days_ids = [],       
    hour_combination_ids = [],       
    segment_ids = [],                
    course_category_ids = [],        
    model_modality_ids = []          
  } = payload

  // Lógica de Activo/Inactivo
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
    // Arrays
    instructores_seleccionados,
    category_ids,
    type_program_ids,
    combination_days_ids,
    hour_combination_ids,
    segment_ids,
    course_category_ids,
    model_modality_ids
  }

  // console.log('Filters enviado a BD:', JSON.stringify(filters))

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_list',
    [JSON.stringify(filters)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return {
    total,
    page: Number(page),
    size: Number(size),
    items: rows
  }
}

/**
 * LIST BY WEEK
 * CALL public.sp_edition_by_week_list(p_filters jsonb, p_cur refcursor)
 */
async function editionByWeeklist (payload = {}) {
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

  const now = new Date()
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

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_by_week_list',
    [JSON.stringify(filters)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows.length 
  
  return {
    ok: true,
    total,
    page,
    size,
    items: rows
  }
}

/**
 * UPDATE (simple)
 * CALL public.sp_edition_update(p_edition jsonb, p_user_id int, p_cur refcursor)
 */

async function editionUpdate ({ id, edition = {}, user_id = null }) {
  const payloadEdition = {
    ...edition,
    edition_num_id: id || edition.edition_num_id
  }
  console.log("LLEGÒ")
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_update',
    [
      JSON.stringify(payloadEdition),
      user_id
    ],
    { statementTimeoutMs: 25000 }
  )

  //get response and result

  const row = rows?.[0] || {}
  console.log(row)
  return {
    message: row.message,
    result: row.result
  }
  
  
}


/**
 * UPDATE TREE (padre + hijos)
 * CALL public.sp_edition_tree_update(p_edition jsonb, p_user_id int, p_cur refcursor)
 */
async function editionTreeUpdate ({ edition = {}, user_id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_tree_update',
    [
      JSON.stringify(edition || {}),
      user_id
    ],
    { statementTimeoutMs: 25000 }
  )

  return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
}

/**
 * OBTENER EDICIÓN (padre + hijos) POR ID
 * CALL public.sp_edition_tree_get(p_edition_num_id int, p_cur refcursor)
 */
async function editionGet ({ id }) {
  const editionId = Number(id) || null
  if (!editionId) return null

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_tree_get',
    [editionId], 
    { statementTimeoutMs: 25000 }
  )

  // Retornamos raw, el front mapea
  return rows?.[0] || null
}


async function auditLogsGet ({ edition_id = null, limit = 50, offset = 0 }) {
  // Convertimos a null explícito si viene undefined o 0, aunque el SP lo maneja
  const pedition_id = edition_id ? Number(edition_id) : null
  const pLimit = Number(limit) || 50
  const pOffset = Number(offset) || 0

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_audit_logs_get',
    [pedition_id, pLimit, pOffset], 
    { statementTimeoutMs: 25000 }
  )

  // Retornamos todas las filas (cada fila es una transacción agrupada)
  return rows || []
}


/**
 * CALLER (para combos, SearchSelect, etc.)
 * CALL public.sp_edition_caller(...)
 */
async function editionCaller (payload = {}) {
  const {
    program_version_id,
    active = null, 
    cat_status_edition = null,
    q = null,
    year = null,
    month = null
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_caller',
    [
      program_version_id,
      active,
      cat_status_edition,
      q,
      month,
      year
    ],
    { statementTimeoutMs: 15000 }
  )

  return rows // Return array directo
}

//editionextrainfocaller


/**
 * CALLER (para combos, SearchSelect, etc.)
 * CALL public.sp_edition_caller(...)
 */
async function editionextrainfocaller (payload = {}) {
  const {
    program_version_id
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_extra_info_caller',
    [
      program_version_id
    ],
    { statementTimeoutMs: 15000 }
  )

  return rows // Return array directo
}


/**
 * Lista enrollments vigentes en una edicion que pasara a A5.
 * Devuelve los datos necesarios para que el operador asigne edicion destino.
 */
async function a5PendingEnrollments ({ edition_num_id }) {
  const editionId = Number(edition_num_id)
  if (!editionId) return []

  return callProcedureReturningRows(
    pool,
    'public.sp_edition_a5_pending_enrollments',
    [editionId],
    { statementTimeoutMs: 20000 }
  )
}

/**
 * Ejecuta migracion masiva + cancelacion A5 en transaccion atomica.
 * payload: { edition_num_id, migrations: [{enrollment_id, target_edition_id}], justificacion, a5_segment_id }
 */
async function a5MigrationExecute ({ payload = {}, user_id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_a5_migration_execute',
    [JSON.stringify(payload || {}), user_id],
    { statementTimeoutMs: 60000 }
  )

  const row = rows?.[0] || {}
  return {
    result: row.result ?? 0,
    message: row.message || 'Sin respuesta del SP',
    migrated_count: row.migrated_count ?? 0
  }
}

async function bulkUpdateWhatsapp (items) {
  let updated = 0
  let notFound = []

  for (const item of items) {
    if (!item.abbreviation || !item.start_date || !item.whatsapp_link) continue

    const parts = item.start_date.split('/')
    let isoDate
    if (parts.length === 3) {
      isoDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    } else {
      isoDate = item.start_date
    }

    const { rowCount } = await pool.query(`
      UPDATE program_editions pe
      SET whatsapp_link = $1
      FROM program_versions pv
      WHERE pv.program_version_id = pe.program_version_id
        AND UPPER(TRIM(pv.abbreviation)) = UPPER(TRIM($2))
        AND pe.start_date::date = $3::date
    `, [item.whatsapp_link.trim(), item.abbreviation.trim(), isoDate])

    if (rowCount > 0) {
      updated += rowCount
    } else {
      notFound.push(`${item.abbreviation} - ${item.start_date}`)
    }
  }

  return { updated, not_found: notFound }
}

// Conteo de alumnos por edicion (aula).
// Reproduce la misma logica de "1. Aula Sistemas" (syncFicoAulaToSheet):
// inscripciones FICO-aprobadas (cat_fico_status = checked), activas, y solo
// hojas del arbol (hijos de programa estructurado OR cursos standalone sin
// hijos). Las marcas visuales SEG/RP/CC pertenecen a cat_type_status y no
// afectan el conteo — un alumno aprobado por FICO esta en el aula sin importar
// si su inscripcion fue luego reprogramada o cambiada de curso (esos badges
// solo indican el origen de la inscripcion).
async function classroomMetricsList ({ edition_ids = [] } = {}) {
  const ids = (edition_ids || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return []

  const { rows } = await pool.query(`
    SELECT e.program_edition_id AS edition_num_id,
           COUNT(*)::int        AS students
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
     WHERE e.program_edition_id = ANY($1::int[])
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (
            e.parent_enrollment_id IS NOT NULL
         OR NOT EXISTS (
              SELECT 1 FROM public.enrollments c
               WHERE c.parent_enrollment_id = e.enrollment_id
            )
       )
     GROUP BY e.program_edition_id
  `, [ids])

  return rows
}

// Listado de alumnos matriculados (FICO-aprobados) en una edicion/aula.
// Misma logica de elegibilidad que classroomMetricsList: solo hojas del arbol
// (modulos hijos o cursos standalone sin hijos). Ordenado por apellido para
// presentacion estable en la matriz de asistencia. Incluye un contacto de
// telefono/email vigente y la modalidad de inscripcion (FLEX/REGULAR).
async function classroomStudentsList ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []

  const { rows } = await pool.query(`
    SELECT e.enrollment_id,
           per.person_id,
           per.document_number                          AS dni,
           TRIM(BOTH FROM concat(per.first_name, ' ', per.last_name)) AS full_name,
           per.first_name,
           per.last_name,
           cts.alias                                    AS type_status_alias,
           cts.description                              AS type_status_label,
           cim.alias                                    AS modality_alias,
           cim.description                              AS modality_label,
           contact_phone.value                          AS phone,
           contact_email.value                          AS email,
           e.registration_date::date                    AS enrolled_on
      FROM public.enrollments e
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id    = cust.person_id
      JOIN public."catalog" cf   ON cf.catalog_id    = e.cat_fico_status
 LEFT JOIN public."catalog" cts  ON cts.catalog_id   = e.cat_type_status
 LEFT JOIN public."catalog" cim  ON cim.catalog_id   = e.cat_inscription_modality
 LEFT JOIN LATERAL (
        SELECT pc.value
          FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1
      ) contact_phone ON TRUE
 LEFT JOIN LATERAL (
        SELECT pc.value
          FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1
      ) contact_email ON TRUE
     WHERE e.program_edition_id = $1
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (
            e.parent_enrollment_id IS NOT NULL
         OR NOT EXISTS (
              SELECT 1 FROM public.enrollments c
               WHERE c.parent_enrollment_id = e.enrollment_id
            )
       )
     ORDER BY per.last_name, per.first_name
  `, [id])

  return rows
}

// Auto-bootstrap idempotente: la rubrica vive en su propia tabla y queremos
// que el deploy no requiera correr migraciones manuales. La primera llamada
// que toque la tabla la crea si no existe; siguientes llamadas saltan el
// CREATE gracias al flag en memoria. Si el proceso reinicia, se re-verifica
// una sola vez con costo despreciable (~1ms).
let _rubricTableReady = false
async function ensureRubricTable () {
  if (_rubricTableReady) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.classroom_audit_rubric (
      rubric_id          SERIAL PRIMARY KEY,
      program_edition_id INTEGER NOT NULL REFERENCES public.program_editions(edition_num_id) ON DELETE CASCADE,
      session_number     INTEGER NOT NULL CHECK (session_number > 0),
      criteria           JSONB NOT NULL DEFAULT '{}'::jsonb,
      ai_report          JSONB,
      ai_metadata        JSONB,
      ai_generated_at    TIMESTAMPTZ,
      updated_by         INTEGER REFERENCES public.users(user_id),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (program_edition_id, session_number)
    );
    CREATE INDEX IF NOT EXISTS idx_car_edition
      ON public.classroom_audit_rubric (program_edition_id);
    -- Migracion idempotente: agrega columnas IA si la tabla ya existia
    ALTER TABLE public.classroom_audit_rubric
      ADD COLUMN IF NOT EXISTS ai_report JSONB,
      ADD COLUMN IF NOT EXISTS ai_metadata JSONB,
      ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ;
  `)
  _rubricTableReady = true
}

// Resumen agregado de auditoria por aula. Una fila por edition_id con la
// cobertura de evaluacion (cuantas sesiones tienen rubrica marcada / cuantas
// fueron analizadas por IA) y los promedios en escala /20 listos para que el
// frontend calcule la nota consolidada y el veredicto.
//
// La rubrica manual tiene 20 items totales (5 interaction + 6 content +
// 3 environment + 6 communication). Si la rubrica cambia de tamano, este
// numero y RUBRIC en el frontend deben moverse juntos.
//
// El score IA viene en escala 1-5 dentro del JSON del reporte y se convierte
// a /20 multiplicando por 4 (misma transformacion que toScore20Num en frontend).
// La consolidacion 0.7*IA + 0.3*Manual se hace en frontend para no congelar
// la formula en SQL.
async function classroomAuditSummaryList ({ edition_ids = [] } = {}) {
  const ids = (edition_ids || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return []
  await ensureRubricTable()

  const { rows } = await pool.query(`
    WITH per_session AS (
      SELECT
        car.program_edition_id,
        car.session_number,
        car.updated_at,
        car.ai_generated_at,
        (SELECT COUNT(*) FROM jsonb_each(car.criteria) WHERE value::boolean = true)::int
          AS manual_marked,
        CASE
          WHEN car.ai_report IS NOT NULL
           AND (car.ai_report #>> '{metricas_rapidas,puntuacion_global}') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (car.ai_report #>> '{metricas_rapidas,puntuacion_global}')::numeric * 4
          ELSE NULL
        END AS ai_score20
      FROM public.classroom_audit_rubric car
      WHERE car.program_edition_id = ANY($1::int[])
    )
    SELECT
      program_edition_id                                                       AS edition_num_id,
      COUNT(*) FILTER (WHERE manual_marked > 0)::int                            AS sessions_manual,
      COUNT(*) FILTER (WHERE ai_score20 IS NOT NULL)::int                       AS sessions_ai,
      ROUND(AVG((manual_marked::numeric / 20.0) * 20.0)
        FILTER (WHERE manual_marked > 0)::numeric, 2)                           AS manual_avg_20,
      ROUND(AVG(ai_score20)
        FILTER (WHERE ai_score20 IS NOT NULL)::numeric, 2)                      AS ai_avg_20,
      MAX(GREATEST(updated_at, COALESCE(ai_generated_at, '-infinity'::timestamptz)))
                                                                                AS last_activity_at
    FROM per_session
    GROUP BY program_edition_id
  `, [ids])

  return rows
}

// Carga toda la rubrica de evaluacion al docente para una edicion (aula).
// Devuelve una fila por sesion ya evaluada; las sesiones sin evaluar no
// aparecen y el frontend asume criterios vacios.
async function classroomAuditGet ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  await ensureRubricTable()
  const { rows } = await pool.query(`
    SELECT session_number, criteria, ai_report, ai_metadata, ai_generated_at,
           updated_by, updated_at
      FROM public.classroom_audit_rubric
     WHERE program_edition_id = $1
     ORDER BY session_number
  `, [id])
  return rows
}

// URL del servicio Python (FastAPI). Convivimos con el backend Node como
// sidecar — el operador arranca el FastAPI con `npm run ai:start` y este
// proxy se encarga de reenviar el multipart al puerto local.
// Validacion anti-SSRF: solo se aceptan hosts locales o explicitamente
// permitidos. Una URL arbitraria via env permitiria exfiltrar el contenido
// del syllabus a un servidor externo controlado por un atacante.
const AI_AUDITOR_ALLOWED_HOSTS = new Set([
  '127.0.0.1', 'localhost', '::1',
  ...(process.env.AI_AUDITOR_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
])

function resolveAiAuditorUrl () {
  const raw = process.env.AI_AUDITOR_URL || 'http://127.0.0.1:8090'
  try {
    const u = new URL(raw)
    if (!AI_AUDITOR_ALLOWED_HOSTS.has(u.hostname)) {
      throw new Error(`AI_AUDITOR_URL host no permitido: ${u.hostname}. Agregalo a AI_AUDITOR_ALLOWED_HOSTS.`)
    }
    return raw
  } catch (err) {
    throw new Error(`AI_AUDITOR_URL invalida: ${err.message}`)
  }
}

const AI_AUDITOR_URL = resolveAiAuditorUrl()

// Ejecuta el analisis IA pasando transcript + imagen del syllabus, persiste
// el reporte completo en la fila (edicion, sesion) correspondiente. El upsert
// preserva los criterios manuales ya marcados — la IA solo agrega/reemplaza
// las columnas ai_report, ai_metadata y ai_generated_at.
async function classroomAuditRunAi ({
  edition_id, session_number, transcript_text, syllabus_image, syllabus_filename,
} = {}) {
  const eid = Number(edition_id)
  const sn = Number(session_number)
  if (!Number.isFinite(eid) || !Number.isFinite(sn) || sn < 1) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  if (!transcript_text || !String(transcript_text).trim()) {
    return { ok: false, message: 'transcript_text vacio' }
  }
  if (!syllabus_image) {
    return { ok: false, message: 'Falta imagen del syllabus' }
  }

  await ensureRubricTable()

  // FormData nativa en Node 18+: el proxy reenvia el multipart al FastAPI
  // sin descomprimir/recomprimir, lo unico que paga es el TCP loopback.
  const form = new FormData()
  form.append('sesion_numero', String(sn))
  form.append('transcript_text', String(transcript_text))
  const blob = new Blob([syllabus_image], { type: 'application/octet-stream' })
  form.append('syllabus_image', blob, syllabus_filename || 'syllabus.png')

  // 10 min de timeout: Gemini con AFC (Automatic Function Calling) puede
  // iterar hasta 10 veces para auto-corregir el output. Sin AbortController
  // el fetch nativo de Node 20 no tiene timeout por defecto y la conexion
  // queda colgada si Gemini muere a media respuesta.
  const aiController = new AbortController()
  const aiTimeoutId = setTimeout(() => aiController.abort(), 10 * 60 * 1000)

  let aiJson
  try {
    const resp = await fetch(`${AI_AUDITOR_URL}/api/audit`, {
      method: 'POST',
      body: form,
      signal: aiController.signal,
    })
    const text = await resp.text()
    console.log('[AI] FastAPI respondio', resp.status, 'body:', text.slice(0, 2000))
    if (!resp.ok) {
      let detail = text.slice(0, 400)
      try {
        const parsed = JSON.parse(text)
        const tb = Array.isArray(parsed.traceback) ? parsed.traceback.join(' | ') : ''
        detail = `${parsed.error || ''}: ${parsed.message || parsed.detail || text}${tb ? ' || ' + tb : ''}`.slice(0, 800)
      } catch { /* no es JSON, usar text crudo */ }
      console.error('[AI] FastAPI error', resp.status, detail)
      return { ok: false, message: `IA respondio ${resp.status}: ${detail}` }
    }
    aiJson = JSON.parse(text)
  } catch (err) {
    const isAbort = err?.name === 'AbortError'
    return {
      ok: false,
      message: isAbort
        ? 'La IA tardo mas de 10 min en responder. Reintenta con un transcript mas corto o revisa que Gemini este disponible.'
        : `No se pudo contactar al servicio IA (${AI_AUDITOR_URL}). Verifica que el FastAPI este corriendo (npm run ai:start). Detalle: ${err.message}`,
    }
  } finally {
    clearTimeout(aiTimeoutId)
  }

  const report = aiJson?.report || null
  const metadata = aiJson?.metadata || null
  if (!report) return { ok: false, message: 'La IA no devolvio reporte' }

  const { rows } = await pool.query(`
    INSERT INTO public.classroom_audit_rubric
      (program_edition_id, session_number, ai_report, ai_metadata, ai_generated_at, updated_at)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW())
    ON CONFLICT (program_edition_id, session_number) DO UPDATE
       SET ai_report = EXCLUDED.ai_report,
           ai_metadata = EXCLUDED.ai_metadata,
           ai_generated_at = NOW(),
           updated_at = NOW()
    RETURNING session_number, criteria, ai_report, ai_metadata, ai_generated_at, updated_at
  `, [eid, sn, JSON.stringify(report), JSON.stringify(metadata)])

  return { ok: true, row: rows[0] }
}

// Upsert atomico de la rubrica de una sesion especifica. Reemplaza el JSONB
// `criteria` completo (no hace merge) — el frontend envia el estado total
// de la sesion, no deltas. Asi evitamos race conditions entre evaluadores.
async function classroomAuditSave ({ edition_id, session_number, criteria, user_id = null } = {}) {
  const eid = Number(edition_id)
  const sn = Number(session_number)
  if (!Number.isFinite(eid) || !Number.isFinite(sn) || sn < 1) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  const payload = criteria && typeof criteria === 'object' ? criteria : {}
  const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null
  await ensureRubricTable()
  // RETURNING incluye ai_report y ai_metadata para que el frontend mantenga
  // el panel de analisis IA visible despues de guardar criterios manuales.
  // La query no toca esas columnas en el UPDATE, asi que conserva su valor.
  const { rows } = await pool.query(`
    INSERT INTO public.classroom_audit_rubric
      (program_edition_id, session_number, criteria, updated_by, updated_at)
    VALUES ($1, $2, $3::jsonb, $4, NOW())
    ON CONFLICT (program_edition_id, session_number) DO UPDATE
       SET criteria = EXCLUDED.criteria,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
    RETURNING session_number, criteria, ai_report, ai_metadata, ai_generated_at,
              updated_by, updated_at
  `, [eid, sn, JSON.stringify(payload), uid])
  return { ok: true, row: rows[0] }
}

export default {
  editionRegister,
  editionTreeRegister,
  editionTreeUpdate,
  editionList,
  editionGet,
  editionUpdate,
  editionCaller,
  editionByWeeklist,
  classroomMetricsList,
  classroomStudentsList,
  classroomAuditGet,
  classroomAuditSummaryList,
  classroomAuditSave,
  classroomAuditRunAi,
  auditLogsGet,
  editionextrainfocaller,
  bulkUpdateWhatsapp,
  a5PendingEnrollments,
  a5MigrationExecute
}