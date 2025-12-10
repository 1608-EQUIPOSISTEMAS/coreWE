// src/services/discount.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

/**
 * REGISTER
 */
async function discountRegister({ discount = {} }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_discount_register',
    [ JSON.stringify(discount || {}) ],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return { discount_id: row.discount_id ?? null }
}

/**
 * LIST
 * Actualizado para sp_discount_list(p_active, p_cat_discount_type, p_is_global, p_q, p_page, p_size)
 */
async function discountList(payload = {}) {
  const {
    active = null,
    cat_discount_type = null,
    is_global = null, // <--- Nuevo filtro soportado por el SP
    q = null,
    page = 1,
    size = 25
  } = payload

  // NOTA: El SP no recibe from_date, to_date ni campaign_id, por eso los quitamos del array.
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_discount_list',
    [
      active,             // p_active
      cat_discount_type,  // p_cat_discount_type
      is_global,          // p_is_global
      q,                  // p_q
      page,               // p_page
      size                // p_size
    ],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  const items = rows.map(r => ({
    discount_id: r.id, // El SP devuelve 'id' y 'discount_id', usaremos id para el front
    description: r.description,
    alias: r.alias,
    
    // Datos de valor
    value: r.value != null ? Number(r.value) : null,
    value_formatted: r.value_formatted, // "10%" o "S/ 50.00" (Viene del SP)

    // Mapeo Tipo
    cat_discount_type_id: r.cat_discount_type,       // ID numérico
    cat_discount_type_alias: r.cat_discount_type_alias, // Alias string (ej: 'we_discount_type_percentage')
    cat_discount_type_label: r.cat_discount_type_label,

    // Mapeo Moneda
    cat_currency_type_id: r.cat_currency_type,
    cat_currency_type_alias: r.cat_currency_type_alias,
    cat_currency_type_label: r.cat_currency_type_label,

    is_global: r.is_global,
    campaign_id: r.campaign_id,
    
    // Fechas (El SP devuelve start_date/end_date como Date o string ISO)
    start_date: r.start_date,
    end_date: r.end_date,
    
    active: r.active
  }))

  return { total, page: Number(page), size: Number(size), items }
}

// ... discountGet y discountUpdate siguen igual ...

/**
 * CALLER (Nuevo)
 * CALL public.sp_discount_caller(p_q text, p_cat_discount_type int, p_active bool)
 */
async function discountCaller(payload = {}) {
  const {
    q = null,
    cat_discount_type = null,
    cat_currency = null,
    active = true
  } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_discount_caller',
    [
      q,
      cat_discount_type,
      cat_currency,
      active
    ],
    { statementTimeoutMs: 10000 }
  )

  // Retornamos directo o mapeamos si quieres estandarizar nombres
  return rows.map(r => ({
    id: r.id,
    description: r.description,
    alias: r.alias,
    value: Number(r.value),
    full_label: r.full_label,       // "Beca (20%)"
    type_label: r.type_label,       // "Porcentaje"
    currency_alias: r.currency_alias
  }))
}

/**
 * GET
 * Modificado para retornar programas y moneda
 */
async function discountGet({ id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_discount_get',
    [ id ],
    { statementTimeoutMs: 25000 }
  )

  const r = rows?.[0] || {}

  return {
    data: {
      discount_id: r.discount_id,
      description: r.description,
      alias: r.alias,
      cat_discount_type: r.cat_discount_type,
      cat_discount_type_id: r.cat_discount_type_id,
      cat_discount_type_label: r.cat_discount_type_label,
      cat_currency_type: r.cat_currency_type, // Nuevo campo
      cat_currency_type_label: r.cat_currency_type_label, // Nuevo campo
      cat_currency_id: r.cat_currency_id, // Nuevo campo
      value: r.value != null ? Number(r.value) : null,
      is_global: r.is_global,
      campaign_id: r.campaign_id,
      campaign_label: r.campaign_label,
      start_date: r.start_date,                 // date (ISO from DB)
      end_date: r.end_date,                     // date (ISO from DB)
      start_date_fmt: r.start_date_fmt,         // 'DD/MM/YYYY'
      end_date_fmt: r.end_date_fmt,             // 'DD/MM/YYYY'
      active: r.active,
      status_calc: r.status_calc,
      programs: r.programs || []                // Nuevo array JSON
    }
  }
}

/**
 * UPDATE
 */
async function discountUpdate({ id, discount = {} }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_discount_update',
    [
      id,
      JSON.stringify(discount || {})
    ],
    { statementTimeoutMs: 25000 }
  )

  const row = rows?.[0] || {}
  return { discount_id: row.discount_id ?? id ?? null }
}


export default {
  discountRegister,
  discountList,
  discountGet,
  discountUpdate,
  discountCaller
}