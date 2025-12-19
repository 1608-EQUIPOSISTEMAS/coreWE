// src/services/instructor.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

/**
 * REGISTER
 * CALL public.sp_instructor_register(p_instructor jsonb, p_cur refcursor)
 */
async function instructorRegister ({ instructor = {} } = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_instructor_register',
    [JSON.stringify(instructor || {})],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    instructor_id: r.instructor_id ?? null,
    person_id: r.person_id ?? null,
    data: r // Se devuelve tal cual viene de la DB
  }
}

/**
 * LIST
 * CALL public.sp_instructor_list(...)
 */
async function instructorList (payload = {}) {
  const {
    active = null,            
    cat_occupation = null,
    cat_person_status = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  // normalizar active a 'Y' / 'N' / null
  let activeParam = null
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'
  else if (typeof active === 'string') activeParam = active

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_instructor_list',
    [
      activeParam,
      cat_occupation,
      cat_person_status,
      q,
      page,
      size
    ],
    { statementTimeoutMs: 25000 }
  )

  // Asumimos que el SP devuelve 'total_count' en cada fila
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return {
    total,
    page: Number(page),
    size: Number(size),
    items: rows // Se devuelve el array directo de la DB
  }
}

/**
 * GET
 * CALL public.sp_instructor_get(p_instructor_id int, p_cur refcursor)
 */
async function instructorGet ({ id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_instructor_get',
    [id],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    data: r // Se devuelve tal cual viene de la DB (incluyendo JSONs anidados)
  }
}

/**
 * UPDATE
 * CALL public.sp_instructor_update(...)
 */
async function instructorUpdate ({ id, instructor = {} }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_instructor_update',
    [
      id,
      JSON.stringify(instructor || {})
    ],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    instructor_id: r.instructor_id ?? id ?? null,
    person_id: r.person_id ?? null,
    data: r // Se devuelve tal cual viene de la DB
  }
}

/**
 * CALLER
 * CALL public.sp_instructor_caller(...)
 */
async function instructorCaller (payload = {}) {
  const {
    active = 'Y',
    cat_occupation = null,
    cat_person_status = null,
    q = null
  } = payload

  let activeParam = null
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'
  else if (typeof active === 'string' && active !== '') activeParam = active

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_instructor_caller',
    [
      activeParam,
      cat_occupation,
      cat_person_status,
      q
    ],
    { statementTimeoutMs: 15000 }
  )

  return rows // Se devuelve el array directo
}

export default {
  instructorRegister,
  instructorList,
  instructorGet,
  instructorCaller,
  instructorUpdate
}