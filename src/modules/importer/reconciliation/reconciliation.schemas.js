// Validacion de entrada (Fastify/AJV) de la conciliacion de hojas FICO. Varias
// hojas del mismo programa (una por año); el orden importa: si una fila se
// repite, manda la ultima. Solo Google Sheets: el backend baja su CSV, asi que
// el patron tambien evita que se use para pedir URLs arbitrarias.

const urls = {
  type: 'array',
  minItems: 1,
  maxItems: 5,
  items: { type: 'string', minLength: 20, maxLength: 500, pattern: '^https://docs\\.google\\.com/spreadsheets/' }
}

export const reconcileSheetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['urls'],
    properties: { urls }
  }
}

// Correcciones (Fase 3): las mismas hojas que se conciliaron + que aplicar a que
// fila. La fila se identifica como la devolvio la conciliacion.
export const applyFixesSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['urls', 'fixes'],
    properties: {
      urls,
      fixes: {
        type: 'array',
        minItems: 1,
        maxItems: 300,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['registration_date', 'agent', 'payments', 'plan', 'children', 'membership', 'annul_duplicates', 'retire', 'import_row', 'link_rp']
            },
            enrollment_id: { type: ['integer', 'null'] },
            row_number: { type: ['integer', 'null'] },
            sheet: { type: ['integer', 'null'] }
          }
        }
      }
    }
  }
}
