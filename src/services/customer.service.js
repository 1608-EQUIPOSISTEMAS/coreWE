// src/services/customer.service.js
import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

/**
 * REGISTER
 * El payload puede contener datos de Persona (first_name...) o Empresa (razon_social...)
 * contacts:  [{ cat_way_contact, cat_country, value }]
 * addresses: [{ cat_address_type, cat_country, cat_street_type, street, street_number,
 *               cat_interior_type, floor_apt, zip_code, reference, is_main }]
 */
async function customerRegister({ customer = {}, contacts = [], addresses = [] }) {
  const payload = { ...customer, contacts, addresses }
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_register',
    [ JSON.stringify(payload) ],
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

  return rows?.[0] || {}
}

/**
 * UPDATE
 * contacts y addresses reemplazan completamente los existentes (el SP hace el upsert/delete).
 */
async function customerUpdate({ id, customer = {}, contacts = [], addresses = [] }) {
  const payload = { ...customer, contacts, addresses }
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_customer_update',
    [
      id,
      JSON.stringify(payload)
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
/**
 * INFO GET — Busca persona/cliente por número de documento
 */
async function customerInfoGet({ document }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_customer_info_get',
    [ document ],
    { statementTimeoutMs: 15000 }
  )

  const r = rows?.[0] || {}
  return {
    result:           r.result ?? 0,
    message:          r.message ?? null,
    person_id:        r.person_id ?? null,
    customer_id:      r.customer_id ?? null,
    first_name:       r.first_name ?? null,
    last_name:        r.last_name ?? null,
    mother_last_name: r.mother_last_name ?? null,
    document_number:  r.document_number ?? null,
    email:            r.email ?? null,
    phone:            r.phone ?? null,
  }
}
export default {
  customerRegister,
  customerList,
  customerGet,
  customerUpdate,
  customerInfoGet,
  customerCaller
}