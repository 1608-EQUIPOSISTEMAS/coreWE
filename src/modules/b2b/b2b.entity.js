// Reglas puras del dominio b2b. Sin BD, Odoo ni Slack.

// Defaulting de respuesta de los SPs que devuelven una fila de resultado.
// Centraliza el fallback historico rows?.[0] || { result: 0, message: ... }.
export function assertSpResult (rows) {
  return rows?.[0] || { result: 0, message: 'No response from DB' }
}

// Primera fila o objeto vacio, para los endpoints *get.
export function firstRowOrEmpty (rows) {
  return rows?.[0] || {}
}

// Lista de filas o arreglo vacio, para los endpoints *list/*caller.
export function rowsOrEmpty (rows) {
  return rows || []
}

// Separa el payload de alta de lead empresa en los tres parametros que espera
// sp_company_lead_register: (p_lead jsonb, p_contact_attempts jsonb, p_user_registration_id integer).
export function normalizeCompanyLeadPayload (payload = {}) {
  return {
    lead: payload.lead || {},
    contactAttempts: payload.contact_attempts || [],
    userRegistrationId: payload.user_registration_id
  }
}

// Normaliza lead_id a entero para sp_company_lead_get (el SP espera INT, no JSON).
// Devuelve null cuando el valor no es numerico para evitar pasar NaN/undefined a PG.
export function normalizeLeadId (leadId) {
  if (leadId === null || leadId === undefined || leadId === '') return null
  const n = Number(leadId)
  return Number.isInteger(n) ? n : null
}

// Garantiza que los descuentos de un agreement sean siempre un array.
export function normalizeDiscounts (discounts) {
  return Array.isArray(discounts) ? discounts : []
}
