// JSON schemas de validacion (Fastify/AJV) del dominio dashboard.
// Movidos verbatim desde las rutas legacy durante la migracion.

export const dashboardListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      year: { type: ['integer', 'null'], default: 2026 },
      month: { type: ['string', 'null'], default: 'ENE' },
      period: { type: ['string', 'null'] },
      modality: { type: ['string', 'null'], default: 'NO_ONLINE' },
      date_start: { type: ['string', 'null'] },
      date_end: { type: ['string', 'null'] }
    }
  }
}

export const programGoalsSchema = {
  body: {
    type: 'object',
    properties: {
      year: { type: 'integer', default: 2026 },
      month_num: { type: 'integer', default: 1 }
    }
  }
}

export const leadsPerEditionSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      edition_ids: {
        type: 'array',
        items: { type: 'integer' },
        default: []
      }
    }
  }
}

export const targetRegisterSchema = {
  body: {
    type: 'object',
    required: ['target'],
    additionalProperties: false,
    properties: {
      target: {
        type: 'object',
        required: ['seller_agent_id', 'year', 'month', 'period', 'date_start', 'date_end'],
        additionalProperties: false,
        properties: {
          seller_agent_id: { type: 'integer' },
          year: { type: 'integer' },
          month: { type: 'string' },
          period: { type: 'string' },
          date_start: { type: 'string' },
          date_end: { type: 'string' },
          target_vacancies: { type: ['integer', 'null'], default: 0 },
          target_revenue: { type: ['number', 'null'], default: 0 }
        }
      }
    }
  }
}

export const detailLeadsSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['date'],
    properties: {
      cod_asesor: { type: ['integer', 'string', 'null'] },
      date: { type: 'string', format: 'date' },
      page: { type: 'integer', minimum: 1, default: 1 },
      size: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
    }
  }
}

export const contactabilitySchema = {
  body: {
    type: 'object',
    properties: {
      year: { type: 'integer', default: 2026 },
      month: { type: 'integer', default: 1 },
      advisor: { type: ['string', 'integer'], default: 'all' }
    }
  }
}

export const liderSchema = {
  body: {
    type: 'object',
    properties: {
      year: { type: 'integer', default: 2026 },
      month: { type: 'integer', default: 1 },
      advisor: { type: ['string', 'integer'], default: 'all' }
    }
  }
}

export const availableWeeksSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      year: { type: ['integer', 'null'], default: 2026 },
      modality: { type: ['string', 'null'], default: 'NO_ONLINE' }
    }
  }
}

export const ventasCanalSchema = {
  body: {
    type: 'object',
    properties: {
      year: { type: 'integer', default: 2026 },
      month_num: { type: 'integer', default: 1 },
      advisor: { type: ['string', 'integer'], default: 'all' }
    }
  }
}

export const detailSalesSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['date'],
    properties: {
      cod_asesor: { type: ['integer', 'string', 'null'] },
      date: { type: 'string', format: 'date' },
      page: { type: 'integer', minimum: 1, default: 1 },
      size: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
    }
  }
}
