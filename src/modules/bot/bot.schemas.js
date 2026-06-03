// JSON schemas de validacion (Fastify/AJV) del dominio bot.
// Migrados desde models/bot.schema.js y endurecidos: tipado de campos,
// rangos de paginacion y cobertura de los endpoints que carecian de schema.

export const botTicketListSchema = {
  tags: ['Bot'],
  summary: 'Lista los tickets del bot con paginacion y filtros',
  body: {
    type: 'object',
    properties: {
      q: { type: ['string', 'null'] },
      status: { type: ['string', 'integer', 'null'] },
      assigned_to: { type: ['integer', 'null'] },
      from_date: { type: ['string', 'null'] },
      to_date: { type: ['string', 'null'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      size: { type: 'integer', minimum: 1, default: 25 }
    },
    additionalProperties: true
  }
}

export const botTicketGetSchema = {
  tags: ['Bot'],
  summary: 'Obtiene el detalle de un ticket del bot',
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: true,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const botTicketUpdateSchema = {
  tags: ['Bot'],
  summary: 'Actualiza un ticket del bot (estado, notas, asignacion)',
  body: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' },
      status: { type: ['string', 'integer', 'null'] },
      notes: { type: ['string', 'null'] },
      assigned_to: { type: ['integer', 'null'] },
      user_id: { type: ['integer', 'null'] }
    },
    additionalProperties: true
  }
}

export const botDashboardMetricsSchema = {
  tags: ['Bot'],
  summary: 'Obtiene los KPIs y metricas del dashboard del bot',
  body: {
    type: 'object',
    properties: {
      from_date: { type: ['string', 'null'] },
      to_date: { type: ['string', 'null'] }
    },
    additionalProperties: true
  }
}

export const botStudentListSchema = {
  tags: ['Bot'],
  summary: 'Lista los alumnos con paginacion y busqueda',
  body: {
    type: 'object',
    properties: {
      q: { type: ['string', 'null'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      size: { type: 'integer', minimum: 1, default: 25 }
    },
    additionalProperties: true
  }
}

export const botStudentGetSchema = {
  tags: ['Bot'],
  summary: 'Obtiene el perfil de un alumno',
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: true,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const botCsatListSchema = {
  tags: ['Bot'],
  summary: 'Lista los registros CSAT con paginacion',
  body: {
    type: 'object',
    properties: {
      q: { type: ['string', 'null'] },
      from_date: { type: ['string', 'null'] },
      to_date: { type: ['string', 'null'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      size: { type: 'integer', minimum: 1, default: 25 }
    },
    additionalProperties: true
  }
}

export const botAdvisorListSchema = {
  tags: ['Bot'],
  summary: 'Lista los asesores asignables a tickets',
  body: {
    type: 'object',
    additionalProperties: true
  }
}
