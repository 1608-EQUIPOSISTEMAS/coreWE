// JSON schema de validacion de entrada (Fastify/AJV) para la ruta de guardado de
// convalidaciones. Identico al que vivia inline en routes/fico.js.

export const saveValidationsSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'validations'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      validations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['child_version_id'],
          additionalProperties: true,
          properties: {
            child_version_id: { type: 'integer' },
            validation_type: { type: 'string' },
            custom_edition_id: { type: ['integer', 'null'] },
            notes: { type: ['string', 'null'] }
          }
        }
      }
    }
  }
}
