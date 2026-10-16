import * as usecases from './prediccion.usecases.js'
import * as bandeja from './bandeja.usecases.js'

export async function fichaHandler (req, reply) {
  const data = await usecases.fichaDelCliente(req.body)
  return reply.send({ ok: true, data })
}

export async function bandejaHandler (req, reply) {
  const data = await bandeja.bandejaDe({ userId: req.body.user_id, requester: req.user })
  return reply.send({ ok: true, data })
}

export async function resultadoHandler (req, reply) {
  const data = await bandeja.registrarResultado({
    assignmentId: req.body.assignment_id, outcome: req.body.outcome, reason: req.body.reason ?? null, requester: req.user
  })
  return reply.send({ ok: true, data })
}

export async function generarHandler (req, reply) {
  const data = await bandeja.generarBandeja()
  return reply.send({ ok: true, data })
}

export async function medicionHandler (req, reply) {
  const data = await bandeja.medicion()
  return reply.send({ ok: true, data })
}

export async function programasHandler (req, reply) {
  const data = await usecases.programasVendibles()
  return reply.send({ ok: true, data })
}

export async function manualHandler (req, reply) {
  const data = await usecases.manualDelPrograma({ programId: req.body.program_id })
  return reply.send({ ok: true, data })
}
