import { DomainError } from '../../shared/errors.js'
import { authRepository } from './auth.repository.js'
import { buildJwtPayload, validateCredentialsResult, requireRoleAlias } from './auth.entity.js'
import { toLoginDto, toUserListDto } from './auth.dto.js'
import { modulesForRoles, submodulesForRoles } from '../../shared/security/module-access.js'

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

  // Módulos y submódulos accesibles según la matriz de Configuración. Si la
  // consulta falla el login no se bloquea: el frontend cae al filtrado por
  // roles hardcodeados.
  let modules, submodules
  try {
    [modules, submodules] = await Promise.all([
      modulesForRoles(user.roles),
      submodulesForRoles(user.roles)
    ])
  } catch (err) {
    console.error('[login] no se pudieron cargar los módulos del usuario:', err.message)
  }

  const token = signToken(buildJwtPayload(user), { expiresIn: '12h' })
  return toLoginDto({
    token,
    user: { ...user, ...(modules && { modules }), ...(submodules && { submodules }) }
  })
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
