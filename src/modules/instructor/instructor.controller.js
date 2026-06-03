import * as usecases from './instructor.usecases.js'

export async function registerHandler (req, reply) {
  const d = await usecases.registerInstructor(req.body)
  return reply.code(201).send({
    ok: true,
    instructor_id: d.instructor_id,
    person_id: d.person_id,
    odoo_user_id: d.odoo_user_id,
    odoo_partner_id: d.odoo_partner_id,
    ...(d.odoo_error && { odoo_error: d.odoo_error }),
    data: d.data
  })
}

export async function listHandler (req, reply) {
  const data = await usecases.listInstructors(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function getHandler (req, reply) {
  const { data } = await usecases.getInstructor(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function updateHandler (req, reply) {
  const { instructor_id, person_id, data } = await usecases.updateInstructor(req.body)
  return reply.code(200).send({ ok: true, instructor_id, person_id, data })
}

export async function callerHandler (req, reply) {
  const items = await usecases.callerInstructors(req.body)
  return reply.code(200).send({ ok: true, items })
}
