// JSON schemas de validacion (Fastify/AJV) del dominio b2b.
// La ruta legacy no declaraba schema en ningun endpoint, por lo que estos
// schemas son intencionalmente permisivos (additionalProperties: true, sin
// required) para no rechazar payloads que hoy ya pasan. Solo aportan tags de
// documentacion y la garantia de que el body es un objeto.

const passthroughBody = (tag, description) => ({
  tags: ['B2B'],
  description,
  body: {
    type: 'object',
    additionalProperties: true
  }
})

// ── COMPANY ──────────────────────────────────────────────────
export const companyCallerSchema = passthroughBody('B2B', 'Caller de empresas B2B (autocomplete/select)')
export const companyListSchema = passthroughBody('B2B', 'Lista empresas B2B con filtros')
export const companyGetSchema = passthroughBody('B2B', 'Obtiene una empresa B2B')
export const companyRegisterSchema = passthroughBody('B2B', 'Registra una empresa B2B')
export const companyUpdateSchema = passthroughBody('B2B', 'Actualiza una empresa B2B')

// ── LEAD EMPRESA ─────────────────────────────────────────────
export const leadListSchema = passthroughBody('B2B', 'Lista leads de empresa')

export const leadGetSchema = {
  tags: ['B2B'],
  description: 'Obtiene un lead de empresa por id',
  body: {
    type: 'object',
    additionalProperties: true,
    properties: {
      lead_id: { type: ['integer', 'string', 'null'] }
    }
  }
}

export const leadRegisterSchema = {
  tags: ['B2B'],
  description: 'Registra un lead de empresa con intentos de contacto',
  body: {
    type: 'object',
    additionalProperties: true,
    properties: {
      lead: { type: ['object', 'null'] },
      contact_attempts: { type: ['array', 'null'] },
      user_registration_id: { type: ['integer', 'null'] }
    }
  }
}

// ── CONTRACT ─────────────────────────────────────────────────
export const contractListSchema = passthroughBody('B2B', 'Lista contratos B2B con filtros')
export const contractGetSchema = passthroughBody('B2B', 'Obtiene un contrato B2B')
export const contractRegisterSchema = passthroughBody('B2B', 'Registra un contrato B2B')
export const contractUpdateSchema = passthroughBody('B2B', 'Actualiza un contrato B2B')
export const contractEnrollSchema = passthroughBody('B2B', 'Manda a FICO los cupos pendientes de un contrato B2B')

