import * as usecases from './program.usecases.js'

export async function registerHandler (req, reply) {
  const { program_id, program_versions } = await usecases.registerProgram(req.body)
  return reply.code(201).send({ ok: true, program_id, program_versions })
}

export async function listHandler (req, reply) {
  const data = await usecases.listPrograms(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function getHandler (req, reply) {
  const { data } = await usecases.getProgram(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function updateHandler (req, reply) {
  const { program_id, program_versions } = await usecases.updateProgram(req.body)
  return reply.code(200).send({ ok: true, program_id, program_versions })
}

export async function versionCallerHandler (req, reply) {
  const data = await usecases.callerProgramVersions(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function priceListHandler (req, reply) {
  const data = await usecases.listPrices(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function versionListHandler (req, reply) {
  const data = await usecases.listProgramVersions(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function versionUpdateHandler (req, reply) {
  const result = await usecases.updatePrice(req.body)
  return reply.code(200).send({ ok: true, data: result })
}

export async function callerHandler (req, reply) {
  const data = await usecases.callerPrograms(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function versionDetailGetHandler (req, reply) {
  const { data } = await usecases.getProgramVersionDetail(req.body)
  return reply.code(200).send({ ok: true, data })
}
