// src/services/program.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

/**
 * REGISTER
 * Se inyecta el user_id dentro del JSON del programa.
 */
async function programRegister ({ program = {}, user_id = null } = {}) {
  // Fusionamos el user_id dentro del objeto program para que el SP lo consuma
  const programPayload = {
    ...program,
    user_id: user_id // Se envía como user_id genérico
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_register',
    [JSON.stringify(programPayload)],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return {
    program_id: row.program_id ?? null,
    program_versions: row.program_versions || []
  }
}

/**
 * LIST
 * Retorna la data cruda (raw) del SP.
 */
async function programList (payload = {}) {
  const {
    active = null,
    cat_type_program = null,
    cat_category = null,
    cat_model_modality = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  let activeParam = null
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'
  else if (typeof active === 'string') activeParam = active

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_list',
    [
      activeParam,
      cat_type_program,
      cat_category,
      cat_model_modality,
      q,
      page,
      size
    ],
    { statementTimeoutMs: 25000 }
  )

  // Extraemos el total del primer row si existe, pero no mapeamos los items
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return { 
    total, 
    page: Number(page), 
    size: Number(size), 
    items: rows // <--- DATA TAL CUAL VIENE DEL SP
  }
}

/**
 * GET
 * Retorna la data cruda (raw) del SP.
 */
async function programGet ({ id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_get',
    [id],
    { statementTimeoutMs: 25000 }
  )

  // Retornamos el primer row tal cual
  return {
    data: rows?.[0] || {} 
  }
}

/**
 * UPDATE
 * Se inyecta el user_id dentro del JSON.
 */
async function programUpdate ({ id, program = {}, user_id = null }) {
  // Fusionamos user_id
  const programPayload = {
    ...program,
    user_id: user_id
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_update',
    [
      id,
      JSON.stringify(programPayload)
    ],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return {
    program_id: row.program_id ?? id ?? null,
    program_versions: row.program_versions || []
  }
}

/**
 * VERSION CALLER
 * Retorna data cruda.
 */
async function programVersionCaller (payload = {}) {
  const {
    cat_model_modality = null,
    active = null,
    not_modality = null,
    cat_type_program   = null,
    q                  = null
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_version_caller',
    [
      active,
      not_modality,
      cat_model_modality,
      cat_type_program,
      q
    ],
    { statementTimeoutMs: 25000 }
  )

  return { items: rows } // <--- DATA TAL CUAL
}

async function programVersionDetailGet ({ program_version_id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_version_detail_get',
    [program_version_id],
    { statementTimeoutMs: 25000 }
  )

  return {
    data: rows?.[0] || {}
  }
}

/**
 * LISTAR VERSIONES DE PROGRAMA
 * Retorna data cruda.
 */
async function programVersionList (payload = {}) {
    
  const {
    program_id = null,
    program_version_id = null,
    active = null,
    q = null,
    cat_type_program = null,
    cat_category = null,
    cat_model_modality = null,
    page = 1,
    size = 25
  } = payload

  let activeParam = null
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'
  else if (typeof active === 'string') activeParam = active

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_version_list',
    [
      program_id,
      activeParam,
      q,
      cat_type_program,
      cat_category,
      cat_model_modality,
      program_version_id,
      page,
      size
    ],
    { statementTimeoutMs: 25000 }
  )
  

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return { 
    total, 
    page: Number(page), 
    size: Number(size), 
    items: rows // <--- DATA TAL CUAL
  }
}

/**
 * PRICE LIST
 * Retorna data cruda.
 */
async function priceList (payload = {}) {
  const { character = null } = payload

  let charParam = null
  if (character !== null && character !== undefined) {
    if (typeof character === 'string') charParam = character.slice(0, 1)
    else charParam = String(character).slice(0, 1)
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_price_list',
    [charParam],
    { statementTimeoutMs: 25000 }
  )

  return { 
    total: rows.length, 
    items: rows // <--- DATA TAL CUAL
  }
}

/**
 * BUSCADOR DE PROGRAMAS (SIMPLE)
 * Retorna data cruda.
 */
async function programCaller(payload = {}) {
  const {
    q = null,
    cat_type_program = null,
    active = 'Y'
  } = payload

  let activeParam = active
  if (typeof active === 'boolean') {
    activeParam = active ? 'Y' : 'N'
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_program_caller',
    [
      q,
      cat_type_program,
      activeParam
    ],
    { statementTimeoutMs: 10000 }
  )

  return rows // <--- DATA TAL CUAL (Array directo)
}

/**
 * UPDATE PRICE
 */
async function priceUpdate(payload = {}) {
  const {
    program_version_id,
    price_student_soles,
    price_student_dollars,
    price_professional_soles,
    price_professional_dollars,
    active,
    price_list_id = 1,
    user_id = 1 // Ya está como user_id
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_price_update',
    [
      program_version_id,
      price_student_soles,
      price_student_dollars,
      price_professional_soles,
      price_professional_dollars,
      active,
      price_list_id,
      user_id
    ],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return { success: row.success ?? true }
}

export default {
  programRegister,
  programCaller,
  programList,
  programGet,
  programUpdate,
  programVersionCaller,
  programVersionList,
  priceList,
  priceUpdate,
  programVersionDetailGet
}