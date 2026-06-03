// JSON schemas de validacion de entrada (Fastify/AJV) para las rutas del sync
// Odoo. Identico al schema inline que vivia en routes/fico.js.

export const enrollInOdooSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}
