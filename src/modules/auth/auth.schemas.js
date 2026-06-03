// JSON schemas de validacion (Fastify/AJV) del dominio auth.
// Movido verbatim desde models/auth.schema.js durante la migracion.

export const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      username: { type: 'string' },
      password: { type: 'string' }
    }
  }
}
