
export async function authenticate (request, reply) {
  try {
    await request.jwtVerify()
  } catch (err) {
    return reply.code(401).send({ ok: false, message: 'Token inválido o expirado' })
  }
}

export function hasRole (allowedRoles) {
  return async function (request, reply) {
    const { roles = [] } = request.user
    const permitted = allowedRoles.some(role => roles.includes(role))
    if (!permitted) {
      return reply.code(403).send({
        ok: false,
        message: `Acceso denegado. Se requiere uno de estos roles: ${allowedRoles.join(', ')}`
      })
    }
  }
}

// ── Roles globales reutilizables ──────────────────────────────
export const ADMIN_ONLY       = hasRole(['ADMIN'])
export const ADMIN_COMERCIAL  = hasRole(['ADMIN', 'LIDER_COMERCIAL'])
export const ALL_COMERCIAL    = hasRole(['ADMIN', 'COMERCIAL', 'LIDER_COMERCIAL'])
export const ADMIN_PRODUCTO  = hasRole(['ADMIN', 'LIDER_PRODUCTO'])
export const ALL_PRODUCTO    = hasRole(['ADMIN', 'PRODUCTO', 'LIDER_PRODUCTO'])
export const ALL_ADMIN    = hasRole(['ADMIN', 'LIDER_COMERCIAL', 'LIDER_PRODUCTO'])