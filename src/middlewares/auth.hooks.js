
export async function authenticate (request, reply) {
  try {
    // SSE no puede enviar headers via EventSource, asi que se permite ?token=
    // como alternativa al header Authorization.
    if (!request.headers.authorization && request.query?.token) {
      request.headers.authorization = `Bearer ${request.query.token}`
    }
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
export const ADMIN_FICO  = hasRole(['ADMIN', 'LIDER_FICO'])
export const ALL_FICO    = hasRole(['ADMIN', 'FICO', 'LIDER_FICO'])
export const ADMIN_ACADEMICA  = hasRole(['ADMIN', 'LIDER_ACADEMICA'])
export const ALL_ACADEMICA    = hasRole(['ADMIN', 'ACADEMICA', 'LIDER_ACADEMICA'])
export const ADMIN_PRODUCTO  = hasRole(['ADMIN', 'LIDER_PRODUCTO'])
export const ALL_PRODUCTO    = hasRole(['ADMIN', 'PRODUCTO', 'LIDER_PRODUCTO'])
export const ALL_ADMIN    = hasRole(['ADMIN', 'LIDER_COMERCIAL', 'LIDER_PRODUCTO'])
export const ALL_B2B      = hasRole(['ADMIN', 'B2B', 'GERENCIA'])

// Gates combinados (OR) — usar uno solo en preHandler.
// Apilar varios hasRole en preHandler los AND-ea (todos deben pasar), por eso
// se exportan estas uniones explícitas.
export const PRODUCTO_COMERCIAL = hasRole([
  'ADMIN',
  'PRODUCTO', 'LIDER_PRODUCTO',
  'COMERCIAL', 'LIDER_COMERCIAL',
  'FICO', 'LIDER_FICO'
])
export const ADMIN_PRODUCTO_COMERCIAL = PRODUCTO_COMERCIAL
export const ALL_INTERNAL = hasRole([
  'ADMIN',
  'COMERCIAL', 'LIDER_COMERCIAL',
  'FICO', 'LIDER_FICO',
  'ACADEMICA', 'LIDER_ACADEMICA',
  'PRODUCTO', 'LIDER_PRODUCTO',
  'B2B', 'GERENCIA'
])