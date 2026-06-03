import * as usecases from './membership.usecases.js'

// Adapter HTTP delgado: lee req, delega al usecase y responde. Sin try/catch —
// los errores de validacion del usecase son DomainError y los normaliza el error
// handler global de buildApp ({ ok: false, error } con status 400/404).

export async function updateMembershipActivationDateHandler (req, reply) {
  const data = await usecases.updateMembershipActivationDate({
    enrollmentId: req.body.enrollment_id,
    newDate: req.body.activation_date,
    userId: req.user?.id ?? null
  })
  return reply.code(200).send({ ok: true, data })
}
