import * as usecases from './auth.usecases.js'

export async function loginHandler (req, reply) {
  const { username, password } = req.body
  const signToken = (payload, opts) => req.server.jwt.sign(payload, opts)
  const data = await usecases.login({ username, password }, signToken)
  return reply.code(200).send({ ok: true, data })
}

export async function userListHandler (req, reply) {
  const data = await usecases.userList()
  return reply.code(200).send({ ok: true, data })
}

export async function userListByRoleHandler (req, reply) {
  const data = await usecases.userListByRole(req.body?.role_alias)
  return reply.code(200).send({ ok: true, data })
}
