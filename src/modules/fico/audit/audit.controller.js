import * as usecases from './audit.usecases.js'

// Adapter HTTP delgado: lee req, delega al usecase, responde. Sin try/catch
// (los errores los normaliza el error handler global de buildApp via
// DomainError). Preserva el shape de respuesta del service legacy.

export async function getAuditLogHandler (req, reply) {
  const data = await usecases.getAuditLog({ enrollmentId: req.body.enrollment_id })
  return reply.code(200).send({ ok: true, data })
}
