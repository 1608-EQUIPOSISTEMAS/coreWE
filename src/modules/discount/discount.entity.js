// Reglas puras del dominio discount. Sin BD, Odoo, Slack ni reloj.

// Garantiza que un valor numerico nunca viaje como string al cliente.
// Devuelve Number(value) o null si el valor es nulo/indefinido.
export function normalizeValue (value) {
  return value != null ? Number(value) : null
}

// Normaliza la paginacion del listado: page minimo 1, size con default 25.
export function paginationDefaults ({ page = 1, size = 25 } = {}) {
  const safePage = Number(page) >= 1 ? Number(page) : 1
  const safeSize = Number(size) >= 1 ? Number(size) : 25
  return { page: safePage, size: safeSize }
}

// Proyeccion de una fila del SP de listado al DTO de item.
// El SP devuelve 'id' y 'discount_id'; el item usa 'id' como discount_id.
export function buildListItem (r) {
  return {
    discount_id: r.id,
    description: r.description,
    alias: r.alias,
    value: normalizeValue(r.value),
    value_formatted: r.value_formatted,
    cat_discount_type_id: r.cat_discount_type,
    cat_discount_type_alias: r.cat_discount_type_alias,
    cat_discount_type_label: r.cat_discount_type_label,
    cat_currency_type_id: r.cat_currency_type,
    cat_currency_type_alias: r.cat_currency_type_alias,
    cat_currency_type_label: r.cat_currency_type_label,
    is_global: r.is_global,
    campaign_id: r.campaign_id,
    start_date: r.start_date,
    end_date: r.end_date,
    active: r.active
  }
}

// Proyeccion de la fila del SP de detalle al DTO de get.
// programs cae a [] cuando el SP devuelve NULL.
export function buildGetResult (r = {}) {
  return {
    discount_id: r.discount_id,
    description: r.description,
    alias: r.alias,
    cat_discount_type: r.cat_discount_type,
    cat_discount_type_id: r.cat_discount_type_id,
    cat_discount_type_label: r.cat_discount_type_label,
    cat_currency_type: r.cat_currency_type,
    cat_currency_type_label: r.cat_currency_type_label,
    cat_currency_id: r.cat_currency_id,
    value: normalizeValue(r.value),
    is_global: r.is_global,
    campaign_id: r.campaign_id,
    campaign_label: r.campaign_label,
    start_date: r.start_date,
    end_date: r.end_date,
    start_date_fmt: r.start_date_fmt,
    end_date_fmt: r.end_date_fmt,
    active: r.active,
    status_calc: r.status_calc,
    programs: r.programs || []
  }
}

// Proyeccion de una fila del SP caller al DTO de seleccion.
export function buildCallerItem (r) {
  return {
    id: r.id,
    description: r.description,
    alias: r.alias,
    value: Number(r.value),
    full_label: r.full_label,
    type_label: r.type_label,
    currency_alias: r.currency_alias
  }
}
