import * as usecases from './retirados.usecases.js'

// Adapter HTTP delgado: los DomainError los normaliza el error handler global.

export async function listRetiradosHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.listRetirados() })
}

export async function enviarEncuestasHandler (req, reply) {
  const data = await usecases.enviarEncuestas({
    enrollmentIds: req.body.enrollment_ids,
    userId: req.user?.id ?? null
  })
  return reply.send({ ok: true, data })
}
