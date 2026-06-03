// JSON schema de validacion de entrada (Fastify/AJV) para POST /confirmpayment.
// Identico al que vivia inline en routes/fico.js.

export const confirmPaymentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      currency_type: { type: 'string' },
      payment_medium: { type: ['string', 'null'] },
      business_entity: { type: ['string', 'null'] },
      financial_entity: { type: ['string', 'null'] },
      // Solo membresias. YYYY-MM-DD. Si > hoy en TZ Lima, difiere Odoo + correo.
      activation_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      installments: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            installment_number: { type: 'integer' },
            amount: { type: 'number' },
            due_date: { type: ['string', 'null'] },
            currency_type: { type: ['string', 'null'] },
            payment_medium: { type: ['string', 'null'] },
            business_entity: { type: ['string', 'null'] },
            financial_entity: { type: ['string', 'null'] }
          }
        }
      }
    }
  }
}
