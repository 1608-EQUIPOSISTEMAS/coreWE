// src/services/customer.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

/**
 * REGISTER
 * El payload puede contener datos de Persona (first_name...) o Empresa (razon_social...)
 */
async function customerRegister({ customer = {} }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_register',
    [ JSON.stringify(customer || {}) ],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return { customer_id: row.customer_id ?? null }
}

/**
 * LIST
 */
async function customerList(payload = {}) {
  const {
    active = null,
    cat_customer_segment = null,
    cat_customer_status = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_list',
    [
      active,
      cat_customer_segment,
      cat_customer_status,
      q,
      page,
      size
    ],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  const items = rows.map(r => ({
    customer_id: r.id,
    display_name: r.display_name,       // Nombre calculado (Persona o Empresa)
    document_number: r.document_number, // Documento unificado
    
    // IDs de enlace
    person_id: r.person_id,
    company_id: r.company_id,

    // Datos específicos disponibles para mostrar si se requieren
    first_name: r.first_name,
    last_name: r.last_name,
    razon_social: r.razon_social,

    // Catálogos
    cat_customer_segment: r.cat_customer_segment,
    cat_customer_segment_label: r.cat_customer_segment_label,
    cat_customer_status: r.cat_customer_status,
    cat_customer_status_label: r.cat_customer_status_label,

    active: r.customer_active,
    registration_date: r.registration_date
  }))

  return { total, page: Number(page), size: Number(size), items }
}

/**
 * GET
 */
async function customerGet({ id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_get',
    [ id ],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    data: {
      customer_id: r.customer_id,
      person_id: r.person_id,
      company_id: r.company_id,

      // Datos Persona
      first_name: r.first_name,
      last_name: r.last_name,
      mother_last_name: r.mother_last_name,
      person_document_number: r.person_document_number,
      person_cat_type_document: r.person_cat_type_document,

      // Datos Empresa
      razon_social: r.razon_social,
      razon_comercial: r.razon_comercial,
      company_document_number: r.company_document_number,
      company_cat_type_document: r.company_cat_type_document,
      
      // Datos Cliente
      cat_customer_segment: r.cat_customer_segment,
      cat_customer_segment_label: r.cat_customer_segment_label,
      cat_customer_status: r.cat_customer_status,
      cat_customer_status_label: r.cat_customer_status_label,
      
      active: r.customer_active,
      registration_date: r.registration_date
    }
  }
}

/**
 * UPDATE
 */
async function customerUpdate({ id, customer = {} }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_update',
    [
      id,
      JSON.stringify(customer || {})
    ],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return { customer_id: row.customer_id ?? id ?? null }
}

/**
 * CALLER
 * Para selects de búsqueda rápida
 */
async function customerCaller(payload = {}) {
  const {
    q = null,
    active = 'Y' 
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_caller',
    [
      active,
      q
    ],
    { statementTimeoutMs: 10000 }
  )

  return rows.map(r => ({
    id: r.customer_id,
    full_name: r.full_name,         // Unificado en SP
    document_number: r.document_number,
    person_id: r.person_id,
    company_id: r.company_id
  }))
}

export default {
  customerRegister,
  customerList,
  customerGet,
  customerUpdate,
  customerCaller
}