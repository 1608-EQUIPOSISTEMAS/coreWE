// JSON schema de validacion (Fastify/AJV) para la ruta de membership. Identico
// al que vivia inline en routes/fico.js: exige enrollment_id entero y
// activation_date en formato YYYY-MM-DD, sin propiedades extra.
export const updateMembershipActivationDateSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'activation_date'],
    additionalProperties: false,
    properties: {
      enrollment_id: { type: 'integer' },
      activation_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    }
  }
}
