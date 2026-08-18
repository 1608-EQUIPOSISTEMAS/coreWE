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

// Resume el envio masivo de cupos a FICO. El SP devuelve una fila por
// beneficiario con su estado; la pantalla necesita el conteo y, sobre todo, la
// lista de los que NO entraron: un envio "exitoso" que dejo a 4 alumnos fuera
// del aula es el peor resultado posible, asi que los rechazos van al frente.
export function summarizeEnrollment (rows = []) {
  const detail = rowsOrEmpty(rows)
  const creados = detail.filter(r => r.estado === 'creado')
  const pendientes = detail.filter(r => r.estado !== 'creado' && r.estado !== 'ya_matriculado')
  return {
    enrolled: creados.length,
    skipped: detail.filter(r => r.estado === 'ya_matriculado').length,
    rejected: pendientes.length,
    detail: [...pendientes, ...creados, ...detail.filter(r => r.estado === 'ya_matriculado')]
  }
}

// Normaliza un identificador a entero: los SPs de consulta reciben INT, no JSON.
// Devuelve null cuando el valor no es numerico para evitar pasar NaN/undefined a PG.
export function normalizeId (id) {
  if (id === null || id === undefined || id === '') return null
  const n = Number(id)
  return Number.isInteger(n) ? n : null
}

// Los SPs de actualizacion reciben el id APARTE del jsonb de datos
// (`sp_b2b_*_update(p_id integer, p_data jsonb)`), pero el formulario manda todo
// junto en un mismo objeto con la clave `id`. Aqui se separan.
export function splitUpdatePayload (payload = {}) {
  const { id, ...data } = payload
  return { id: normalizeId(id), data }
}
