// JSON schemas de validacion (Fastify/AJV) del dominio integration.
// Movidos verbatim desde routes/integration.js durante la migracion. Las rutas
// sin body declarado en el legacy reciben un schema explicito de body vacio
// para rechazar payloads inesperados.

export const syncLeadsToSheetSchema = {
  tags: ['Integration'],
  body: {
    type: 'object',
    required: ['user_id'],
    additionalProperties: false,
    properties: {
      user_id: {
        type: 'integer',
        additionalProperties: true
      }
    }
  }
}

export const syncInscToSheetSchema = {
  tags: ['Integration'],
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: false,
    properties: {
      enrollment_id: {
        type: 'integer',
        additionalProperties: true
      }
    }
  }
}

export const syncScheduleToSheetSchema = {
  tags: ['Integration'],
  body: { type: 'object', additionalProperties: true, properties: {} }
}

export const syncRprospectosSchema = {
  tags: ['Integration'],
  body: { type: 'object', additionalProperties: false, properties: {} }
}

export const syncEnrollmentToSheetSchema = {
  tags: ['Integration'],
  body: { type: 'object', additionalProperties: false, properties: {} }
}

export const syncFicoSalesToSheetSchema = {
  tags: ['Integration'],
  body: { type: 'object', additionalProperties: false, properties: {} }
}

export const syncFicoToSheetsSchema = {
  tags: ['Integration'],
  body: { type: 'object', additionalProperties: false, properties: {} }
}

export const sendSlackReportSchema = {
  tags: ['Integration'],
  body: {
    type: 'object',
    required: ['titulo', 'texto'],
    additionalProperties: false,
    properties: {
      titulo: { type: 'string', minLength: 1 },
      texto: { type: 'string', minLength: 1 },
      imagenesUrls: {
        type: 'array',
        items: { type: 'string' },
        default: []
      }
    }
  }
}
