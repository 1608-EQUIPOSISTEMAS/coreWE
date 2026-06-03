// JSON schemas de validacion de entrada (Fastify/AJV) para las rutas de cuotas.
// Identicos a los que vivian inline en routes/fico.js.

export const confirmInstallmentSchema = {
  body: {
    type: 'object',
    required: ['installment_id', 'enrollment_id'],
    additionalProperties: true,
    properties: {
      installment_id: { type: 'integer' },
      enrollment_id: { type: 'integer' },
      cat_currency: { type: ['integer', 'null'] },
      cat_payment_medium: { type: ['integer', 'null'] },
      cat_business_entity: { type: ['integer', 'null'] },
      bank_account_id: { type: ['integer', 'null'] },
      transaction_code: { type: ['string', 'null'] },
      voucher_url: { type: ['string', 'null'] },
      payment_date: { type: ['string', 'null'] }
    }
  }
}

export const editInstallmentAmountSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'installment_id', 'new_amount', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      installment_id: { type: 'integer' },
      new_amount: { type: 'number' },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const addInstallmentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'amount', 'due_date', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      amount: { type: 'number' },
      due_date: { type: 'string', minLength: 1 },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const rescheduleInstallmentsSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'changes', 'justificacion'],
    additionalProperties: false,
    properties: {
      enrollment_id: { type: 'integer' },
      justificacion: { type: 'string', minLength: 1 },
      reason_code: { type: ['string', 'null'] },
      changes: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['installment_id', 'new_due_date'],
          additionalProperties: false,
          properties: {
            installment_id: { type: 'integer' },
            new_due_date: { type: 'string', minLength: 10 }
          }
        }
      }
    }
  }
}

export const syncInstallmentPaymentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' },
      installment_number: { type: ['integer', 'null'] }
    }
  }
}
