// src/services/instructor.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

/**
 * REGISTER
 * CALL public.sp_instructor_register(p_instructor jsonb, p_cur refcursor)
 * -> rows[0]: full row (instructor + persona + labels)
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
    // te devuelvo todo lo que trae el SP, similar a instructorGet:
    data: {
      instructor_id: r.instructor_id,
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      mother_last_name: r.mother_last_name,
      document_number: r.document_number,
      cat_type_document: r.cat_type_document,
      cat_type_document_label: r.cat_type_document_label,
      cat_occupation: r.cat_occupation,
      cat_occupation_label: r.cat_occupation_label,
      cat_person_status: r.cat_person_status,
      cat_person_status_label: r.cat_person_status_label,
      cat_country: r.cat_country,
      cat_country_label: r.cat_country_label,
      birthday: r.birthday,
      person_active: r.person_active,
      instructor_active: r.instructor_active,
      person_user_registration_id: r.person_user_registration_id,
      person_user_modification_id: r.person_user_modification_id,
      person_registration_date: r.person_registration_date,
      person_modification_date: r.person_modification_date,
      instructor_user_registration_id: r.instructor_user_registration_id,
      instructor_user_modification_id: r.instructor_user_modification_id,
      instructor_registration_date: r.instructor_registration_date,
      instructor_modification_date: r.instructor_modification_date
    }
  }
}

/**
 * LIST
 * CALL public.sp_instructor_list(
 *   p_active bpchar, p_cat_occupation int,
 *   p_cat_person_status int, p_q text,
 *   p_page int, p_size int, p_cur refcursor
 * )
 * -> rows: [{ total_count, ...fields }]
 */
async function instructorList (payload = {}) {
  const {
    active = null,            // puede venir boolean o 'Y'/'N'
    cat_occupation = null,
    cat_person_status = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  // normalizar active a 'Y' / 'N' / null (DB usa bpchar)
  let activeParam = null
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'
  else if (typeof active === 'string') activeParam = active // ya viene 'Y' o 'N'

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

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  const items = rows.map(r => ({
    instructor_id: r.instructor_id,
    person_id: r.person_id,
    first_name: r.first_name,
    last_name: r.last_name,
    mother_last_name: r.mother_last_name,
    document_number: r.document_number,
    cat_type_document: r.cat_type_document,
    cat_type_document_label: r.cat_type_document_label,
    cat_occupation: r.cat_occupation,
    cat_occupation_label: r.cat_occupation_label,
    cat_person_status: r.cat_person_status,
    cat_person_status_label: r.cat_person_status_label,
    cat_country: r.cat_country,
    cat_country_label: r.cat_country_label,
    birthday: r.birthday,
    person_active: r.person_active,
    instructor_active: r.instructor_active,
    registration_date: r.registration_date,
    modification_date: r.modification_date
  }))

  return {
    total,
    page: Number(page),
    size: Number(size),
    items
  }
}

/**
 * GET
 * CALL public.sp_instructor_get(p_instructor_id int, p_cur refcursor)
 * -> rows[0]: instructor + persona + labels
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
    data: {
      instructor_id: r.instructor_id,
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      mother_last_name: r.mother_last_name,
      document_number: r.document_number,
      cat_type_document: r.cat_type_document,
      cat_type_document_label: r.cat_type_document_label,
      cat_occupation: r.cat_occupation,
      cat_occupation_label: r.cat_occupation_label,
      cat_person_status: r.cat_person_status,
      cat_person_status_label: r.cat_person_status_label,
      cat_country: r.cat_country,
      cat_country_label: r.cat_country_label,
      birthday: r.birthday,
      person_active: r.person_active,
      instructor_active: r.instructor_active,
      person_user_registration_id: r.person_user_registration_id,
      person_user_modification_id: r.person_user_modification_id,
      person_registration_date: r.person_registration_date,
      person_modification_date: r.person_modification_date,
      instructor_user_registration_id: r.instructor_user_registration_id,
      instructor_user_modification_id: r.instructor_user_modification_id,
      instructor_registration_date: r.instructor_registration_date,
      instructor_modification_date: r.instructor_modification_date
    }
  }
}

/**
 * UPDATE
 * CALL public.sp_instructor_update(
 *   p_instructor_id int,
 *   p_instructor jsonb,
 *   p_cur refcursor
 * )
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
    data: {
      instructor_id: r.instructor_id,
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      mother_last_name: r.mother_last_name,
      document_number: r.document_number,
      cat_type_document: r.cat_type_document,
      cat_type_document_label: r.cat_type_document_label,
      cat_occupation: r.cat_occupation,
      cat_occupation_label: r.cat_occupation_label,
      cat_person_status: r.cat_person_status,
      cat_person_status_label: r.cat_person_status_label,
      cat_country: r.cat_country,
      cat_country_label: r.cat_country_label,
      birthday: r.birthday,
      person_active: r.person_active,
      instructor_active: r.instructor_active,
      person_user_registration_id: r.person_user_registration_id,
      person_user_modification_id: r.person_user_modification_id,
      person_registration_date: r.person_registration_date,
      person_modification_date: r.person_modification_date,
      instructor_user_registration_id: r.instructor_user_registration_id,
      instructor_user_modification_id: r.instructor_user_modification_id,
      instructor_registration_date: r.instructor_registration_date,
      instructor_modification_date: r.instructor_modification_date
    }
  }
}

/**
 * CALLER (para SearchSelect, combos, etc.)
 * CALL public.sp_instructor_caller(
 *   p_active bpchar,
 *   p_cat_occupation int,
 *   p_cat_person_status int,
 *   p_q text,
 *   p_cur refcursor
 * )
 * -> rows: [{ instructor_id, full_name, ... }]
 */
async function instructorCaller (payload = {}) {
  const {
    active = 'Y',          // por defecto solo activos
    cat_occupation = null,
    cat_person_status = null,
    q = null
  } = payload

  // normalizar active a 'Y' / 'N' / null (DB usa bpchar)
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

  // para el caller devolvemos el array plano de filas
  return rows.map(r => ({
    instructor_id: r.instructor_id,
    person_id: r.person_id,
    first_name: r.first_name,
    last_name: r.last_name,
    mother_last_name: r.mother_last_name,
    document_number: r.document_number,
    cat_type_document: r.cat_type_document,
    cat_type_document_label: r.cat_type_document_label,
    cat_occupation: r.cat_occupation,
    cat_occupation_label: r.cat_occupation_label,
    cat_person_status: r.cat_person_status,
    cat_person_status_label: r.cat_person_status_label,
    cat_country: r.cat_country,
    cat_country_label: r.cat_country_label,
    birthday: r.birthday,
    person_active: r.person_active,
    instructor_active: r.instructor_active,
    full_name: r.full_name // 🔹 importante para el SearchSelect
  }))
}


export default {
  instructorRegister,
  instructorList,
  instructorGet,
  instructorCaller,
  instructorUpdate
}
