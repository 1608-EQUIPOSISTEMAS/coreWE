// src/services/instructor.service.js
import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'
import odooClient from '../config/odooClient.js'
import slack from '../config/slack.js'  

/**
 * REGISTER
 * CALL public.sp_instructor_register(p_instructor json, p_instructor_id int OUT, p_person_id int OUT, p_odoo_user_id int OUT, p_odoo_partner_id int OUT, p_odoo_error text OUT)
 */
async function instructorRegister ({ instructor = {} } = {}) {
  // ── 1. Registro local vía SP ──────────────────────────────
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_instructor_register',
    [JSON.stringify(instructor)],
    { statementTimeoutMs: 25000 }
  )

  const r             = rows?.[0] ?? {}
  const instructor_id = r.instructor_id ?? null
  const person_id     = r.person_id     ?? null

  if (!instructor_id) throw new Error('sp_instructor_register no devolvió instructor_id')

  // ── 2. Generar password temporal: DNI@We2025! ─────────────
  const password = `${instructor.document_number ?? 'doc'}@We2026!`

  const fullName = [
    instructor.first_name,
    instructor.last_name,
    instructor.mother_last_name
  ].filter(Boolean).join(' ').trim()

  // ── 3. Sync con Odoo ──────────────────────────────────────
  const { odoo_user_id, odoo_partner_id, odoo_error } =
    await odooClient.syncInstructorToOdoo({
      login:         instructor.email          ?? null,
      name:          fullName                  || null,
      password,                                          // ← estaba faltando
      linkedin:      instructor.linkedin       ?? null,
      internalNotes: instructor.profile_resume ?? null,
      parentId:      instructor.odoo_parent_id ?? null
    })

  // ── 4. Persistir IDs Odoo en BD ───────────────────────────
  if (odoo_user_id && odoo_partner_id) {
    await pool.query(
      'CALL public.sp_instructor_set_odoo($1, $2, $3)',
      [instructor_id, odoo_user_id, odoo_partner_id]
    )
  }

  if (odoo_error) {
    console.warn(`[instructorService] Odoo sync falló para instructor ${instructor_id}: ${odoo_error}`)
  }

  // ── 5. Notificar a Slack ───────────────────────────────────
  await slack.notifyInstructorCredentials({
    fullName,
    email:        instructor.email ?? null,
    password,
    instructorId: instructor_id
  })

  return {
    instructor_id,
    person_id,
    odoo_user_id:    odoo_user_id    ?? null,
    odoo_partner_id: odoo_partner_id ?? null,
    odoo_error:      odoo_error      ?? null,
    data: r
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