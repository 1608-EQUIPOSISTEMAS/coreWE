// src/schemas/discount.schema.js

export const discountRegisterSchema = {
  body: {
    type: 'object',
    required: ['discount'],
    additionalProperties: false,
    properties: {
      discount: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: ['string', 'null'] },
          alias: { type: ['string', 'null'] },
          cat_discount_type: { type: ['integer', 'null'] },
          cat_currency_type: { type: ['integer', 'null'] },
          value: { type: ['number', 'null'] },
          is_global: { type: ['boolean', 'null'] },
          campaign_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          active: { type: ['boolean', 'null'] },
          program_ids: {
            type: ['array', 'null'],
            items: { type: 'integer' }
          }
        }
      }
    }
  }
}

export const discountListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: ['boolean', 'null'] },
      cat_discount_type: { type: ['integer', 'null'] },
      is_global: { type: ['boolean', 'null'] },
      q: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 }
    }
  }
}

export const discountGetSchema = {
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const discountUpdateSchema = {
  body: {
    type: 'object',
    required: ['id', 'discount'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' },
      discount: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: ['string', 'null'] },
          alias: { type: ['string', 'null'] },
          cat_discount_type: { type: ['integer', 'null'] },
          cat_currency_type: { type: ['integer', 'null'] },
          value: { type: ['number', 'null'] },
          is_global: { type: ['boolean', 'null'] },
          campaign_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          active: { type: ['boolean', 'null'] },
          program_ids: {
            type: ['array', 'null'],
            items: { type: 'integer' }
          }
        }
      }
    }
  }
}

export const discountCallerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: ['string', 'null'] },
      cat_discount_type: { type: ['integer', 'null'] },
      cat_currency: { type: ['integer', 'null'] },
      active: { type: ['boolean', 'null'], default: true }
    }
  }
}