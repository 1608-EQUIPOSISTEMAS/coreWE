import { DomainError, NotFoundError } from '../../shared/errors.js'
import { configRepository } from './config.repository.js'
import {
  requireId,
  validateRoleInput,
  validateRoleUpdate,
  validateUserInput,
  normalizeRoleIds,
  normalizeIntList,
  forbidSuperRole,
  SUPER_ROLE_ALIAS
} from './config.entity.js'
import { toUserListDto, toRoleListDto, toModuleListDto } from './config.dto.js'
import { modulesForRoles, submodulesForRoles, clearModuleAccessCache } from '../../shared/security/module-access.js'
import { odoo } from '../../shared/adapters/odoo/odoo.adapter.js'

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

// ── Cursos online de la membresia ───────────────────────────
//
// Define QUE cursos del Campus entran cuando se activa una membresia. Antes el
// criterio era "todo lo publicado en la web", asi que cada curso nuevo se
// autoinscribia. Aca ADMIN mantiene la lista.

// Canales publicados en Odoo marcados con si estan o no en la membresia. La
// lista viva manda: un canal despublicado desaparece del checklist y sale en
// `orphans` para que se vea por que bajo el conteo.
export async function listMembershipCourses () {
  const [channels, saved] = await Promise.all([
    odoo.listOnlineChannels(),
    repo.membershipCourseList()
  ])
  const savedById = new Map(saved.map(r => [r.odoo_channel_id, r]))
  const publishedIds = new Set(channels.map(c => c.id))

  return {
    configured: saved.length > 0,
    channels: channels.map(c => ({
      id: c.id,
      name: c.name,
      included: savedById.has(c.id)
    })),
    orphans: saved
      .filter(r => !publishedIds.has(r.odoo_channel_id))
      .map(r => ({ id: r.odoo_channel_id, name: r.name })),
    updated_at: saved.reduce((max, r) => (!max || r.updated_at > max ? r.updated_at : max), null)
  }
}

export async function saveMembershipCourses (body = {}) {
  const ids = normalizeIntList(body.channel_ids, 'channel_ids')
  // Resolvemos el nombre contra Odoo en vez de confiar en el que manda el
  // cliente: la tabla guarda el nombre solo para mostrarlo si el canal
  // desaparece, y un nombre inventado ahi seria imposible de rastrear.
  const channels = await odoo.listOnlineChannels()
  const nameById = new Map(channels.map(c => [c.id, c.name]))
  const unknown = ids.filter(id => !nameById.has(id))
  if (unknown.length) {
    throw new DomainError(
      `Estos canales no existen o no estan publicados en Odoo: ${unknown.join(', ')}`,
      { statusCode: 400 }
    )
  }
  const count = await repo.membershipCourseReplace(
    ids.map(id => ({ id, name: nameById.get(id) })),
    body.user_id ?? null
  )
  return { courses_saved: count }
}

export { SUPER_ROLE_ALIAS }
