import { DomainError, NotFoundError } from '../../shared/errors.js'
import { configRepository } from './config.repository.js'
import {
  requireId,
  validateRoleInput,
  validateRoleUpdate,
  validateUserInput,
  normalizeRoleIds,
  forbidSuperRole,
  SUPER_ROLE_ALIAS
} from './config.entity.js'
import { toUserListDto, toRoleListDto, toModuleListDto } from './config.dto.js'
import { modulesForRoles, submodulesForRoles, clearModuleAccessCache } from '../../shared/security/module-access.js'

const repo = configRepository

// ── Usuarios ────────────────────────────────────────────────

export async function listUsers () {
  return toUserListDto(await repo.userList())
}

export async function registerUser (body = {}) {
  const user = validateUserInput(body.user || {}, { isNew: true })
  if (await repo.aliasExists(user.alias)) {
    throw new DomainError(`Ya existe un usuario con alias ${user.alias}`, { statusCode: 409 })
  }
  // NOTA: la contraseña se guarda tal cual porque sp_auth_login compara texto
  // plano. Migrar a hash (pgcrypto/bcrypt) requiere actualizar ese SP a la vez.
  return repo.userCreate(user, body.user_id ?? null)
}

export async function updateUser (body = {}) {
  const userId = requireId(body.id, 'id')
  const user = validateUserInput(body.user || {}, { isNew: false })
  if (await repo.aliasExists(user.alias, userId)) {
    throw new DomainError(`Ya existe otro usuario con alias ${user.alias}`, { statusCode: 409 })
  }
  const result = await repo.userUpdate(userId, user, body.user_id ?? null)
  if (!result) throw new NotFoundError('Usuario no encontrado')
  return result
}

// ── Roles ───────────────────────────────────────────────────

export async function listRoles () {
  return toRoleListDto(await repo.roleList())
}

export async function registerRole (body = {}) {
  const role = validateRoleInput(body.role || {})
  forbidSuperRole(role.alias, 'crear otro rol con ese alias')
  if (await repo.roleAliasExists(role.alias)) {
    throw new DomainError(`Ya existe un rol con alias ${role.alias}`, { statusCode: 409 })
  }
  const rolId = await repo.roleCreate(role)
  return { rol_id: rolId }
}

export async function updateRole (body = {}) {
  const { rolId, description } = validateRoleUpdate(body.role || {})
  const existing = await repo.roleGet(rolId)
  if (!existing) throw new NotFoundError('Rol no encontrado')
  forbidSuperRole(existing.alias, 'modificar')
  await repo.roleUpdate(rolId, description)
  return { rol_id: rolId }
}

// ── Módulos y permisos ──────────────────────────────────────

export async function listModules () {
  return toModuleListDto(await repo.moduleList())
}

export async function updatePermissions (body = {}) {
  const rolId = requireId(body.rol_id, 'rol_id')
  const moduleIds = normalizeRoleIds(body.module_ids)
  const submoduleIds = normalizeRoleIds(body.submodule_ids)
  const role = await repo.roleGet(rolId)
  if (!role) throw new NotFoundError('Rol no encontrado')
  // ADMIN es superusuario por código: su matriz no se persiste ni edita.
  forbidSuperRole(role.alias, 'editar sus permisos')
  const count = await repo.permissionReplace(rolId, moduleIds, submoduleIds)
  // Invalida el cache de los gates para que el cambio aplique de inmediato.
  clearModuleAccessCache()
  return { rol_id: rolId, modules_assigned: count, submodules_assigned: submoduleIds.length }
}

// Módulos y submódulos del usuario autenticado (según sus roles del JWT).
// Lo consume el sidebar para reflejar cambios de permisos sin re-login.
export async function myModules (roles = []) {
  const [modules, submodules] = await Promise.all([
    modulesForRoles(roles),
    submodulesForRoles(roles)
  ])
  return { modules, submodules }
}

export { SUPER_ROLE_ALIAS }
