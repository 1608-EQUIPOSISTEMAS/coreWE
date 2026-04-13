// src/models/bot.schema.js

const anyBody = {
  body: { type: 'object', additionalProperties: true }
}

export const botTicketListSchema       = anyBody
export const botTicketGetSchema        = anyBody
export const botTicketUpdateSchema     = anyBody
export const botDashboardMetricsSchema = anyBody

export const botStudentListSchema = {
  body: {
    type: 'object',
    properties: {
      q:    { type: ['string',  'null'] },
      page: { type: 'integer', default: 1 },
      size: { type: 'integer', default: 25 }
    },
    additionalProperties: true
  }
}

export const botStudentGetSchema = {
  body: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' }
    }
  }
}
