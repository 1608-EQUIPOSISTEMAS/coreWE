import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

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
  )
  console.log(rows)
  return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
}

/**
 * LIST
 * CALL public.sp_edition_list(p_filters jsonb, p_cur refcursor)
 */
async function editionList (payload = {}) {
  const {
    date_from = null,
    date_to = null,
    instructor_id = null,
    program_version_id = null,
    cat_type_program = null,
    cat_category = null,
    cat_day_combination = null,
    cat_hour_combination = null,
    cat_model_modality = null,
    cat_segment = null,
    cat_course_category = null,
    clasification = null,
    active = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  let activeParam = active
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'

  const filters = {
    date_from,
    date_to,
    instructor_id,
    program_version_id,
    cat_type_program,
    cat_category,
    cat_day_combination,
    cat_hour_combination,
    active: activeParam,
    cat_segment,
    cat_course_category,
    cat_model_modality,
    clasification,
    q,
    page,
    size
  }

  console.log(filters)

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
  editionByWeeklist
  
}