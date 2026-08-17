import * as usecases from './b2b.usecases.js'

// ── COMPANY ──────────────────────────────────────────────────

export async function companyCallerHandler (req, reply) {
  const data = await usecases.companyCaller(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function companyListHandler (req, reply) {
  const data = await usecases.companyList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function companyGetHandler (req, reply) {
  const data = await usecases.companyGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function companyRegisterHandler (req, reply) {
  const response = await usecases.companyRegister(req.body)
  return reply.code(200).send(response)
}

export async function companyUpdateHandler (req, reply) {
  const response = await usecases.companyUpdate(req.body)
  return reply.code(200).send(response)
}

// ── LEAD EMPRESA ─────────────────────────────────────────────

export async function leadListHandler (req, reply) {
  const data = await usecases.companyLeadList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function leadGetHandler (req, reply) {
  const data = await usecases.companyLeadGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function leadRegisterHandler (req, reply) {
  const response = await usecases.companyLeadRegister(req.body)
  return reply.code(200).send(response)
}

// ── CONTRACT ─────────────────────────────────────────────────

export async function contractListHandler (req, reply) {
  const data = await usecases.contractList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function contractGetHandler (req, reply) {
  const data = await usecases.contractGet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function contractRegisterHandler (req, reply) {
  const response = await usecases.contractRegister(req.body)
  return reply.code(200).send(response)
}

export async function contractUpdateHandler (req, reply) {
  const response = await usecases.contractUpdate(req.body)
  return reply.code(200).send(response)
}

export async function contractEnrollHandler (req, reply) {
  // El autor del envio sale del token, no del body: es quien queda como
  // user_registration_id de cada inscripcion creada.
  const response = await usecases.contractEnrollBeneficiaries({
    ...req.body,
    user_id: req.user?.id ?? req.body?.user_id ?? null
  })
  return reply.code(200).send(response)
}
