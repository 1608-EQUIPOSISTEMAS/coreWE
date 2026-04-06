// src/services/b2b.service.js
import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

// ── COMPANY ──────────────────────────────────────────────────

async function companyCaller(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_company_caller',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 10000 }
  )
  return rows || []
}

async function companyList(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_company_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows || []
}

async function companyGet(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_company_get',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 10000 }
  )
  return rows?.[0] || {}
}

async function companyRegister(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_company_register',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

async function companyUpdate(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_company_update',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

// ── LEAD EMPRESA (NUEVO) ─────────────────────────────────────

async function companyLeadList(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_company_lead_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows || []
}

async function companyLeadGet(payload = {}) {
  // El SP sp_company_lead_get espera un INT como parámetro
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_company_lead_get',
    [payload.lead_id],
    { statementTimeoutMs: 10000 }
  )
  return rows?.[0] || {}
}

async function companyLeadRegister(payload = {}) {
  // El SP sp_company_lead_register espera: (p_lead jsonb, p_contact_attempts jsonb, p_user_registration_id integer)
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_company_lead_register',
    [
      JSON.stringify(payload.lead || {}), 
      JSON.stringify(payload.contact_attempts || []), 
      payload.user_registration_id
    ],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

// ── CONTRACT ─────────────────────────────────────────────────

async function contractList(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_contract_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows || []
}

async function contractGet(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_contract_get',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 10000 }
  )
  return rows?.[0] || {}
}

async function contractRegister(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_contract_register',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

async function contractUpdate(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_contract_update',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

// ── AGREEMENT ────────────────────────────────────────────────

async function agreementList(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )
  return rows || []
}

async function agreementGet(payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_get',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 10000 }
  )
  return rows?.[0] || {}
}

async function agreementRegister({ agreement = {}, discounts = [] }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_register',
    [
      JSON.stringify(agreement),
      JSON.stringify(discounts)
    ],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

async function agreementUpdate({ agreement = {}, discounts = [] }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_b2b_agreement_update',
    [
      JSON.stringify(agreement),
      JSON.stringify(discounts)
    ],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

export default {
  companyCaller,
  companyList,
  companyGet,
  companyRegister,
  companyUpdate,
  companyLeadList,      // NUEVO
  companyLeadGet,       // NUEVO
  companyLeadRegister,  // NUEVO
  contractList,
  contractGet,
  contractRegister,
  contractUpdate,
  agreementList,
  agreementGet,
  agreementRegister,
  agreementUpdate
}