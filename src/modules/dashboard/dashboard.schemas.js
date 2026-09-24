import { AREA_OF_LEADER } from '../../shared/organigrama.js'

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

export const goalHistorySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      year: { type: 'integer', default: 2026 },
      month_num: { type: 'integer', default: 1 }
    }
  }
}

// Gerencia > Parametros: el estandar por programa, que es de donde sale el
// objetivo de cada edicion futura.
export const goalStandardsSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      season: { type: 'string', enum: ['ALTA', 'NORMAL'], default: 'NORMAL' }
    }
  }
}

export const goalStandardsSaveSchema = {
  body: {
    type: 'object',
    required: ['standards'],
    additionalProperties: false,
    properties: {
      season: { type: 'string', enum: ['ALTA', 'NORMAL'], default: 'NORMAL' },
      standards: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['program_version_id'],
          additionalProperties: false,
          properties: {
            program_version_id: { type: 'integer' },
            lado: { type: 'string', enum: ['APERTURA', 'SEGUIMIENTO'] },
            // { MARKETING: { ventas, consultas }, ... }. No se enumeran los
            // canales: agregar uno no puede exigir tocar el schema.
            canales: { type: 'object' }
          }
        }
      }
    }
  }
}

export const goalStandardsApplySchema = { body: { type: 'object', additionalProperties: false, properties: {} } }

export const programGoalsSaveSchema = {
  body: {
    type: 'object',
    required: ['goals'],
    additionalProperties: false,
    properties: {
      goals: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['edition_num_id'],
          additionalProperties: false,
          properties: {
            edition_num_id: { type: 'integer' },
            target_vacants: { type: ['integer', 'null'], default: 0 },
            target_revenue: { type: ['number', 'null'], default: 0 },
            // Sin default: omitirlos debe dejar las metas de canal como están.
            target_leads: { type: ['integer', 'null'] },
            channel_goals: {
              type: ['object', 'null'],
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  consultas: { type: 'integer', default: 0 },
                  ventas: { type: 'integer', default: 0 }
                }
              }
            }
          }
        }
      }
    }
  }
}

export const gerenciaFunnelSchema = {
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

// El alcance sale del token, nunca del cuerpo: un colaborador no puede pedir el
// panel de otra area escribiendo su rol en el payload. view_as es la unica
// entrada, y teamScopeFor solo la respeta cuando quien pide es ADMIN.
export const teamSummarySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { view_as: { type: 'string', enum: Object.keys(AREA_OF_LEADER) } }
  }
}

// Mismo view_as que el panel de equipo: solo lo respeta para ADMIN.
export const dailyPlanSchema = teamSummarySchema
