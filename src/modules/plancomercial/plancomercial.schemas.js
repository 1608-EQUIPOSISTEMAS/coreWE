const monthStart = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])-01$' }
const goal = { type: ['number', 'string', 'null'] }
// Linea del plan: En Vivo (lo de siempre, por defecto) u Online.
const line = { type: 'string', enum: ['VIVO', 'ONLINE'], default: 'VIVO' }

const year = { type: 'integer', minimum: 2025, maximum: 2100 }

export const objetivosSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['year'],
    properties: { year, line }
  }
}

// Re-compra y Anual miran a toda la empresa: no tienen linea.
export const yearSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['year'],
    properties: { year }
  }
}

export const monthSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['month_start'],
    properties: { month_start: monthStart, line }
  }
}

// Las fechas de cada semana las recalcula el usecase: del payload solo se lee
// date_start como llave.
export const savePlanSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['month_start', 'weeks'],
    properties: {
      month_start: monthStart,
      line,
      productos: { type: 'object', additionalProperties: goal },
      weeks: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          required: ['date_start'],
          properties: {
            date_start: { type: 'string', format: 'date' },
            obj_vacantes: goal,
            obj_ingresos: goal,
            asesores: { type: 'object', additionalProperties: goal }
          }
        }
      }
    }
  }
}

export const reportSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['date_start', 'date_end'],
    properties: {
      date_start: { type: 'string', format: 'date' },
      date_end: { type: 'string', format: 'date' }
    }
  }
}
