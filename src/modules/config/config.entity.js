// Reglas puras del dominio config (usuarios, roles y permisos por módulo).
// Sin BD, JWT, red ni reloj oculto.
import { DomainError } from '../../shared/errors.js'

// ADMIN es superusuario: el código le concede todos los módulos y por eso su
// matriz de permisos no es editable ni se persiste.
export const SUPER_ROLE_ALIAS = 'ADMIN'

export function requireId (raw, field = 'id') {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new DomainError(`${field} es obligatorio y debe ser un entero positivo`, { statusCode: 400 })
  }
  return id
}

// Normaliza el alias de un rol: mayúsculas, sin espacios (se reemplazan por _),
// solo A-Z, 0-9 y _. Es el identificador estable que viaja en el JWT.
export function normalizeRoleAlias (rawAlias) {
  const alias = String(rawAlias || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
  if (!alias) {
    throw new DomainError('El alias del rol es obligatorio', { statusCode: 400 })
  }
  if (!/^[A-Z0-9_]{2,40}$/.test(alias)) {
    throw new DomainError('Alias inválido: use solo letras, números y _ (2 a 40 caracteres)', { statusCode: 400 })
  }
  return alias
}

export function validateRoleInput ({ description, alias }) {
  const desc = String(description || '').trim()
  if (!desc) {
    throw new DomainError('La descripción del rol es obligatoria', { statusCode: 400 })
  }
  return { description: desc, alias: normalizeRoleAlias(alias) }
}

// El alias no se renombra una vez creado: los gates del backend y los JWT
// vigentes lo referencian como string. Solo se permite editar la descripción.
export function validateRoleUpdate ({ rol_id, description }) {
  const rolId = requireId(rol_id, 'rol_id')
  const desc = String(description || '').trim()
  if (!desc) {
    throw new DomainError('La descripción del rol es obligatoria', { statusCode: 400 })
  }
  return { rolId, description: desc }
}

export function forbidSuperRole (roleAlias, action) {
  if (roleAlias === SUPER_ROLE_ALIAS) {
    throw new DomainError(`El rol ${SUPER_ROLE_ALIAS} es superusuario: no se puede ${action}`, { statusCode: 400 })
  }
}

// Teléfonos asignados al usuario (números de contacto de los asesores
// comerciales). Se normalizan a solo dígitos, 6 a 15 caracteres, sin duplicados.
export function normalizePhones (rawPhones) {
  if (rawPhones == null) return []
  if (!Array.isArray(rawPhones)) {
    throw new DomainError('telefonos debe ser una lista', { statusCode: 400 })
  }
  const phones = []
  for (const raw of rawPhones) {
    const phone = String(raw || '').replace(/\D/g, '')
    if (!phone) continue
    if (phone.length < 6 || phone.length > 15) {
      throw new DomainError(`Teléfono inválido: ${raw}`, { statusCode: 400 })
    }
    if (!phones.includes(phone)) phones.push(phone)
  }
  return phones
}

export function normalizeRoleIds (rawRoleIds) {
  if (rawRoleIds == null) return []
  if (!Array.isArray(rawRoleIds)) {
    throw new DomainError('roles debe ser una lista de rol_id', { statusCode: 400 })
  }
  return [...new Set(rawRoleIds.map(id => requireId(id, 'rol_id')))]
}

export function validateUserInput (user = {}, { isNew = false } = {}) {
  const alias = String(user.alias || '').trim().toUpperCase()
  const firstName = String(user.first_name || '').trim()
  const lastName = String(user.last_name || '').trim()
  const email = String(user.email || '').trim() || null
  const password = user.password == null ? null : String(user.password)

  if (!alias || alias.length < 2) {
    throw new DomainError('El alias del usuario es obligatorio (mínimo 2 caracteres)', { statusCode: 400 })
  }
  if (!firstName) {
    throw new DomainError('El nombre es obligatorio', { statusCode: 400 })
  }
  if (isNew && (!password || password.length < 6)) {
    throw new DomainError('La contraseña es obligatoria (mínimo 6 caracteres)', { statusCode: 400 })
  }
  if (!isNew && password !== null && password.length < 6) {
    throw new DomainError('La nueva contraseña debe tener al menos 6 caracteres', { statusCode: 400 })
  }

  return {
    alias,
    firstName,
    lastName,
    email,
    password,
    active: user.active === 'N' ? 'N' : 'Y',
    phones: normalizePhones(user.telefonos),
    roleIds: normalizeRoleIds(user.roles)
  }
}
