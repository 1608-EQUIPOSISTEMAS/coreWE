// JSON schemas de validacion de entrada (Fastify/AJV) para las rutas de correos
// transaccionales FICO. Identicos a los que vivian inline en routes/fico.js.

export const sendConfirmationEmailSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' },
      cc: { type: ['string', 'array', 'null'], items: { type: 'string' } }
    }
  }
}

export const sendPaymentConfirmationEmailSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}

export const previewEmailSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' },
      override_edition_id: { type: ['integer', 'null'] },
      // Solo membresias. Permite ver el preview con la fecha que el usuario
      // esta a punto de elegir, antes de persistirla en BD.
      activation_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    }
  }
}

export const emailLogsSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}
