// Validacion de entrada (Fastify/AJV) de la conciliacion de hojas FICO. Varias
// hojas del mismo programa (una por año); el orden importa: si una fila se
// repite, manda la ultima. Solo Google Sheets: el backend baja su CSV, asi que
// el patron tambien evita que se use para pedir URLs arbitrarias.

export const reconcileSheetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['urls'],
    properties: {
      urls: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: { type: 'string', minLength: 20, maxLength: 500, pattern: '^https://docs\.google\.com/spreadsheets/' }
      }
    }
  }
}
