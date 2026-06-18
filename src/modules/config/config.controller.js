import * as usecases from './config.usecases.js'

export async function userListHandler (req, reply) {
  const data = await usecases.listUsers()
  return reply.code(200).send({ ok: true, data })
}

export async function userRegisterHandler (req, reply) {
  const data = await usecases.registerUser(req.body)
  return reply.code(201).send({ ok: true, ...data })
}

export async function userUpdateHandler (req, reply) {
  const data = await usecases.updateUser(req.body)
  return reply.code(200).send({ ok: true, ...data })
}

export async function roleListHandler (req, reply) {
  const data = await usecases.listRoles()
  return reply.code(200).send({ ok: true, data })
}

export async function roleRegisterHandler (req, reply) {
  const data = await usecases.registerRole(req.body)
  return reply.code(201).send({ ok: true, ...data })
}

export async function roleUpdateHandler (req, reply) {
  const data = await usecases.updateRole(req.body)
  return reply.code(200).send({ ok: true, ...data })
}

export async function moduleListHandler (req, reply) {
  const data = await usecases.listModules()
  return reply.code(200).send({ ok: true, data })
}

export async function permissionUpdateHandler (req, reply) {
  const data = await usecases.updatePermissions(req.body)
  return reply.code(200).send({ ok: true, ...data })
}

export async function myModulesHandler (req, reply) {
  const data = await usecases.myModules(req.user?.roles || [])
  return reply.code(200).send({ ok: true, data })
}
