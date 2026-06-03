import { DomainError } from '../../shared/errors.js'
import { authRepository } from './auth.repository.js'
import { buildJwtPayload, validateCredentialsResult, requireRoleAlias } from './auth.entity.js'
import { toLoginDto, toUserListDto } from './auth.dto.js'

const repo = authRepository

// Autentica al usuario contra el SP y firma su JWT. El firmador (fastify.jwt.sign)
// se inyecta desde el controller para mantener el usecase testeable sin servidor.
// Paridad con el legacy: cualquier fallo (credenciales invalidas o error de infra)
// responde 401 con el mismo mensaje, sin revelar la causa. El detalle queda en log.
export async function login ({ username, password }, signToken) {
  let user
  try {
    user = validateCredentialsResult(await repo.login(username, password))
  } catch (err) {
    console.error('[login]', err.message)
    throw new DomainError('Usuario o contraseña incorrectos', { statusCode: 401 })
  }

  const token = signToken(buildJwtPayload(user), { expiresIn: '12h' })
  return toLoginDto({ token, user })
}

export async function userList () {
  const rows = await repo.userList()
  return toUserListDto(rows)
}

export async function userListByRole (rawRoleAlias) {
  const roleAlias = requireRoleAlias(rawRoleAlias)
  const rows = await repo.userListByRole(roleAlias)
  return toUserListDto(rows)
}
