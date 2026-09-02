import * as usecases from './reprogramacion.usecases.js'

// Unico lugar que sabe de HTTP. Traduce body -> caso de uso y resultado -> reply.
const num = v => (v === null || v === undefined || v === '' ? null : Number(v))

export async function listHandler (req, reply) {
  const data = await usecases.listAffected()
  return reply.code(200).send({ ok: true, data })
}

export async function destinationsHandler (req, reply) {
  const data = await usecases.listDestinationEditions({
    programVersionId: num(req.body.program_version_id)
  })
  return reply.code(200).send({ ok: true, data })
}

export async function proposeHandler (req, reply) {
  const data = await usecases.proposeDestination({
    enrollmentId: num(req.body.enrollment_id),
    destProgramVersionId: num(req.body.dest_program_version_id),
    destEditionId: num(req.body.dest_edition_id),
    salida: req.body.salida,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function contactHandler (req, reply) {
  const data = await usecases.markContacted({
    enrollmentId: num(req.body.enrollment_id),
    notes: req.body.notes,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, data })
}

export async function acceptHandler (req, reply) {
  const data = await usecases.acceptCase({
    enrollmentId: num(req.body.enrollment_id),
    notes: req.body.notes,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, message: 'Alumno reubicado', data })
}

export async function rejectHandler (req, reply) {
  const data = await usecases.rejectCase({
    enrollmentId: num(req.body.enrollment_id),
    notes: req.body.notes,
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, data })
}
