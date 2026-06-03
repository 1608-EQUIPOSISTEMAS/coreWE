// Reglas puras del dominio customer. Sin BD, red, Odoo ni Slack.

// Normaliza el filtro 'active' al dominio del SP: booleano -> 'Y'/'N',
// string -> tal cual, resto -> null. Mismo patron que instructor.entity.js.
export function normalizeActive (active) {
  if (active === true) return 'Y'
  if (active === false) return 'N'
  if (typeof active === 'string') return active
  return null
}

// Resuelve el nombre a mostrar de un cliente, sea persona o empresa.
// Prioriza razon social; si no, compone el nombre de la persona.
export function buildDisplayName ({ first_name, last_name, mother_last_name, razon_social } = {}) {
  if (razon_social && String(razon_social).trim() !== '') return String(razon_social).trim()
  return [first_name, last_name, mother_last_name].filter(Boolean).join(' ').trim()
}

// Determina el tipo de documento por longitud: 11 digitos -> RUC, resto -> DNI.
export function detectDocumentType (document) {
  return String(document).length === 11 ? 'RUC' : 'DNI'
}

// Mapea la respuesta cruda de ruc.com.pe a la forma unificada del dominio.
// Lanza si la respuesta no corresponde a un RUC ni a un DNI reconocible.
export function mapSunatResponse (apiResponse = {}) {
  if (apiResponse.ruc) {
    return {
      document_type: 'RUC',
      document_number: apiResponse.ruc,
      nombre_o_razon_social: apiResponse.nombre_o_razon_social
    }
  }
  if (apiResponse.dni) {
    return {
      document_type: 'DNI',
      document_number: apiResponse.dni,
      nombre_o_razon_social: apiResponse.nombre_completo
    }
  }
  throw new Error('Tipo de documento no reconocido en la respuesta de la API.')
}

// Construye la estructura paginada del listado a partir de las filas del SP.
// Lee total_count de la primera fila (paridad con sp_customer_list).
export function buildListResult ({ rows = [], page = 1, size = 25 } = {}) {
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0
  const items = rows.map(r => ({
    customer_id: r.id,
    display_name: r.display_name,
    document_number: r.document_number,
    person_id: r.person_id,
    company_id: r.company_id,
    first_name: r.first_name,
    last_name: r.last_name,
    razon_social: r.razon_social,
    cat_customer_segment: r.cat_customer_segment,
    cat_customer_segment_label: r.cat_customer_segment_label,
    cat_customer_status: r.cat_customer_status,
    cat_customer_status_label: r.cat_customer_status_label,
    active: r.customer_active,
    registration_date: r.registration_date
  }))
  return { total, page: Number(page), size: Number(size), items }
}
