import * as usecases from './audit.usecases.js'

export async function auditLogListHandler (req, reply) {
  const data = await usecases.listAuditLog(req.user?.roles || [], req.body)
  return reply.code(200).send({ ok: true, data })
}
