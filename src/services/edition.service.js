import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'


// import { handleSpResponse } from '../plugins/dbResponse'
import { handleSpResponse } from '../plugins/dbResponse.js'
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

async function editionUpdate ({ id, edition = {}, user_id }) {
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


async function auditLogsGet ({ editionId = null, limit = 50, offset = 0 }) {
  // Convertimos a null explícito si viene undefined o 0, aunque el SP lo maneja
  const pEditionId = editionId ? Number(editionId) : null
  const pLimit = Number(limit) || 50
  const pOffset = Number(offset) || 0

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_audit_logs_get',
    [pEditionId, pLimit, pOffset], 
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

export default {
  editionRegister,
  editionTreeRegister,
  editionTreeUpdate,
  editionList,
  editionGet,
  editionUpdate,
  editionCaller,
  editionByWeeklist,
  auditLogsGet
  
}