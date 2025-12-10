// src/services/corporate_agreement.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

/**
 * REGISTER
 * CALL public.sp_b2b_agreement_register(p_json jsonb, p_cur refcursor)
 * -> rows[0]: full row (agreement + labels)
 */
async function agreementRegister ({ agreement = {} } = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_register',
    [JSON.stringify(agreement || {})],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    agreement_id: r.agreement_id ?? null,
    data: {
      agreement_id: r.agreement_id,
      company_id: r.company_id,
      company_label: r.company_label,
      intermediary_id: r.intermediary_id,
      intermediary_label: r.intermediary_label,
      discount_live_pct: r.discount_live_pct,
      discount_online_pct: r.discount_online_pct,
      start_date: r.start_date,
      end_date: r.end_date,
      active: r.active,
      registration_date: r.registration_date
    }
  }
}

/**
 * LIST
 * CALL public.sp_b2b_agreement_list(
 * p_active bpchar, p_q text,
 * p_page int, p_size int, p_cur refcursor
 * )
 * -> rows: [{ total_count, ...fields }]
 */
async function agreementList (payload = {}) {
  const {
    active = null,
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
    'public.sp_b2b_agreement_list',
    [
      activeParam,
      q,
      page,
      size
    ],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  const items = rows.map(r => ({
    agreement_id: r.agreement_id,
    company_id: r.company_id,
    company_name: r.company_name,
    company_commercial_name: r.company_commercial_name,
    intermediary_id: r.intermediary_id,
    intermediary_name: r.intermediary_name,
    full_label: r.full_label, // Label compuesto para grilla
    discount_live_pct: r.discount_live_pct,
    discount_online_pct: r.discount_online_pct,
    start_date: r.start_date,
    end_date: r.end_date,
    active: r.active,
    registration_date: r.registration_date
  }))

  return {
    total,
    page: Number(page),
    size: Number(size),
    items
  }
}

/**
 * CALLER
 * CALL public.sp_b2b_agreement_caller(
 * p_active bpchar, p_q text, p_cur refcursor
 * )
 * -> rows: [{ agreement_id, full_label, ... }]
 */
async function agreementCaller (payload = {}) {
  const {
    active = 'Y', 
    q = null
  } = payload

  let activeParam = null
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'
  else if (typeof active === 'string' && active !== '') activeParam = active

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_caller',
    [
      activeParam,
      q
    ],
    { statementTimeoutMs: 15000 }
  )

  return rows.map(r => ({
    agreement_id: r.agreement_id,
    company_id: r.company_id,
    razon_social: r.razon_social,
    full_label: r.full_label,         // Label útil para el SearchSelect
    discount_live_pct: r.discount_live_pct,
    discount_online_pct: r.discount_online_pct
  }))
}

/**
 * UPDATE
 * CALL public.sp_b2b_agreement_update(
 * p_agreement_id int,
 * p_json jsonb,
 * p_cur refcursor
 * )
 */
async function agreementUpdate ({ id, agreement = {} }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_update',
    [
      id,
      JSON.stringify(agreement || {})
    ],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    agreement_id: r.agreement_id ?? id ?? null,
    data: {
      agreement_id: r.agreement_id,
      company_id: r.company_id,
      company_label: r.company_label,
      intermediary_id: r.intermediary_id,
      intermediary_label: r.intermediary_label,
      discount_live_pct: r.discount_live_pct,
      discount_online_pct: r.discount_online_pct,
      start_date: r.start_date,
      end_date: r.end_date,
      active: r.active,
      modification_date: r.modification_date
    }
  }
}

export default {
  agreementRegister,
  agreementList,
  agreementCaller,
  agreementUpdate
}