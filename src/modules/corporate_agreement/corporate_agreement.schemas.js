// JSON schemas de validacion (Fastify/AJV) del dominio corporate_agreement.
// Movidos verbatim desde los schemas inline de routes/corporate_agreement.js.

export const agreementRegisterSchema = {
  body: {
    type: 'object',
    required: ['agreement'],
    additionalProperties: false,
    properties: {
      agreement: {
        type: 'object',
        required: ['company_id'],
        additionalProperties: false,
        properties: {
          company_id:           { type: 'integer' },
          intermediary_id:      { type: ['integer', 'null'] },

          discount_live_pct:    { type: ['number', 'null'] },
          discount_online_pct:  { type: ['number', 'null'] },

          start_date:           { type: ['string', 'null'] },
          end_date:             { type: ['string', 'null'] },

          active:               { type: ['string', 'null'] },

          user_registration_id: { type: ['integer', 'null'] }
        }
      }
    }
  }
}

export const agreementListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: ['boolean', 'string', 'null'] },
      q:      { type: ['string', 'null'] },
      page:   { type: ['integer', 'null'], default: 1 },
      size:   { type: ['integer', 'null'], default: 25 }
    }
  }
}

export const agreementCallerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: ['boolean', 'string', 'null'] },
      q:      { type: ['string', 'null'] }
    }
  }
}

export const agreementUpdateSchema = {
  body: {
    type: 'object',
    required: ['id', 'agreement'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' },
      agreement: {
        type: 'object',
        additionalProperties: false,
        properties: {
          company_id:           { type: ['integer', 'null'] },
          intermediary_id:      { type: ['integer', 'null'] },

          discount_live_pct:    { type: ['number', 'null'] },
          discount_online_pct:  { type: ['number', 'null'] },

          start_date:           { type: ['string', 'null'] },
          end_date:             { type: ['string', 'null'] },

          active:               { type: ['string', 'null'] },

          user_modification_id: { type: ['integer', 'null'] }
        }
      }
    }
  }
}
