// Reglas puras del dominio auth. Sin BD, JWT, red ni reloj oculto.
import { DomainError } from '../../shared/errors.js'

// Construye el payload que se firma como JWT a partir del usuario crudo del SP.
// Forma exacta esperada por el cliente: { id, username, roles }.
export function buildJwtPayload (user = {}) {
  return {
    id: user.user_id,
    username: user.alias,
    roles: user.roles
  }
}

// Valida el resultado del SP de login. Si no hay usuario, lanza DomainError(401)
// para que el error handler global devuelva el 401 que espera el frontend.
export function validateCredentialsResult (user) {
  if (!user) {
    throw new DomainError('Usuario o contraseña incorrectos', { statusCode: 401 })
  }
  return user
}

// Normaliza el alias de rol recibido y exige su presencia para el listado por rol.
export function requireRoleAlias (rawRoleAlias) {
  const roleAlias = (rawRoleAlias || '').trim()
  if (!roleAlias) {
    throw new DomainError('role_alias es obligatorio', { statusCode: 400 })
  }
  return roleAlias
}
