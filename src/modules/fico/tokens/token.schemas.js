// JSON schemas de validacion de entrada (Fastify/AJV) para las rutas de tokens.
// Identicos a los que vivian inline en routes/token.js.

export const createTokenSchema = {
  body: {
    type: 'object',
    required: ['lead_id', 'cat_provider', 'amount'],
    additionalProperties: true,
    properties: {
      lead_id: { type: 'integer' },
      enrollment_id: { type: ['integer', 'null'] },
      cat_provider: { type: 'integer' },
      amount: { type: 'number' },
      currency: { type: ['string', 'null'] },
      payment_url: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] },
      expiration_date: { type: ['string', 'null'] },
      cat_payment_channel: { type: ['integer', 'null'] }
    }
  }
}

export const updateTokenSchema = {
  body: {
    type: 'object',
    required: ['token_id'],
    additionalProperties: true,
    properties: {
      token_id: { type: 'integer' },
      payment_url: { type: ['string', 'null'] },
      provider_reference: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] },
      expiration_date: { type: ['string', 'null'] },
      cat_provider: { type: ['integer', 'null'] },
      amount: { type: ['number', 'null'] }
    }
  }
}

export const markPaidSchema = {
  body: {
    type: 'object',
    required: ['token_id'],
    additionalProperties: true,
    properties: {
      token_id: { type: 'integer' },
      provider_reference: { type: ['string', 'null'] }
    }
  }
}

export const confirmTokenSchema = {
  body: {
    type: 'object',
    required: ['token_id'],
    additionalProperties: true,
    properties: {
      token_id: { type: 'integer' },
      provider_reference: { type: ['string', 'null'] }
    }
  }
}

export const groupTokensSchema = {
  body: {
    type: 'object',
    required: ['token_ids'],
    properties: {
      token_ids: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 5 }
    }
  }
}

export const editInscriptionSchema = {
  body: {
    type: 'object',
    required: ['token_id', 'inscription'],
    properties: {
      token_id: { type: 'integer' },
      inscription: { type: 'object', additionalProperties: true },
      amount: { type: ['number', 'null'] },
      currency: { type: ['string', 'null'] },
      payment_type: { type: ['string', 'null'] },
      cat_payment_channel: { type: ['integer', 'null'] },
      advisor_observation: { type: ['string', 'null'] }
    }
  }
}

export const ungroupSchema = {
  body: {
    type: 'object',
    required: ['group_id'],
    properties: {
      group_id: { type: 'string' }
    }
  }
}
