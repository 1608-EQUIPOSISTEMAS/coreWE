// JSON schema de validacion de entrada (Fastify/AJV) para la consulta del log
// de auditoria. Identico al que vivia inline en routes/fico.js para /auditlog.

export const getAuditLogSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}
