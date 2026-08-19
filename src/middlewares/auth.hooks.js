import { userHasModule } from '../shared/security/module-access.js'

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

// Gate de unión: pasa si el rol está en la lista fija O si la matriz
// rol_module_permission (módulo Configuración) otorga alguno de los módulos.
// Así los roles creados dinámicamente obtienen acceso a nivel módulo sin
// tocar código; los gates de líderes (ADMIN_*) siguen siendo solo por rol.
export function hasModuleOrRole (moduleCodes, allowedRoles) {
  return async function (request, reply) {
    const { roles = [] } = request.user
    if (allowedRoles.some(role => roles.includes(role))) return
    if (await userHasModule(roles, moduleCodes)) return
    return reply.code(403).send({
      ok: false,
      message: `Acceso denegado. Se requiere uno de estos roles: ${allowedRoles.join(', ')} o permiso al módulo en Configuración.`
    })
  }
}

// ── Roles globales reutilizables ──────────────────────────────
export const ADMIN_ONLY       = hasRole(['ADMIN'])
export const ADMIN_COMERCIAL  = hasRole(['ADMIN', 'LIDER_COMERCIAL'])
// FUNDACION/LIDER_FUNDACION entran aqui porque /fundacion/leads registra y
// lista sus consultas contra los mismos endpoints /comercial/lead*.
// B2B/GERENCIA por lo mismo: /b2b/leads/new monta el mismo useLeadForm y postea
// a /comercial/leadregister. Sin esto el rol B2B recibia 403 y el formulario
// solo mostraba "Error inesperado al guardar el lead".
export const ALL_COMERCIAL    = hasModuleOrRole('COMERCIAL', ['ADMIN', 'COMERCIAL', 'LIDER_COMERCIAL', 'FUNDACION', 'LIDER_FUNDACION', 'B2B', 'GERENCIA'])
export const ADMIN_FICO  = hasRole(['ADMIN', 'LIDER_FICO'])
export const ALL_FICO    = hasModuleOrRole('FICO', ['ADMIN', 'FICO', 'LIDER_FICO'])
export const ADMIN_ACADEMICA  = hasRole(['ADMIN', 'LIDER_ACADEMICA'])
export const ALL_ACADEMICA    = hasModuleOrRole('ACADEMICA', ['ADMIN', 'ACADEMICA', 'LIDER_ACADEMICA'])
export const ADMIN_PRODUCTO  = hasRole(['ADMIN', 'LIDER_PRODUCTO'])
export const ALL_PRODUCTO    = hasModuleOrRole('PRODUCTO', ['ADMIN', 'PRODUCTO', 'LIDER_PRODUCTO'])
export const ALL_ADMIN    = hasRole(['ADMIN', 'LIDER_COMERCIAL', 'LIDER_PRODUCTO'])
// Fundacion entra por los campos "Empresa vinculada" y "Convenio corporativo"
// del formulario de leads, que consultan /b2b/companylist y /b2b/agreementlist.
export const ALL_B2B      = hasModuleOrRole('B2B', ['ADMIN', 'B2B', 'GERENCIA', 'FUNDACION', 'LIDER_FUNDACION'])
// Mismos roles que declara _nav.js para el grupo Marketing del sidebar.
export const ALL_MARKETING = hasModuleOrRole('MARKETING', ['ADMIN', 'GERENCIA'])

// Gates combinados (OR) — usar uno solo en preHandler.
// Apilar varios hasRole en preHandler los AND-ea (todos deben pasar), por eso
// se exportan estas uniones explícitas.
export const PRODUCTO_COMERCIAL = hasModuleOrRole(['PRODUCTO', 'COMERCIAL', 'FICO'], [
  'ADMIN',
  'PRODUCTO', 'LIDER_PRODUCTO',
  'COMERCIAL', 'LIDER_COMERCIAL',
  'FICO', 'LIDER_FICO',
  // Fundacion necesita el buscador de programas (/program/programversioncaller)
  // para registrar sus consultas.
  'FUNDACION', 'LIDER_FUNDACION'
])
export const ADMIN_PRODUCTO_COMERCIAL = PRODUCTO_COMERCIAL
// '*' = cualquier módulo otorgado en la matriz cuenta como usuario interno.
export const ALL_INTERNAL = hasModuleOrRole(['*'], [
  'ADMIN',
  'COMERCIAL', 'LIDER_COMERCIAL',
  'FICO', 'LIDER_FICO',
  'ACADEMICA', 'LIDER_ACADEMICA',
  'PRODUCTO', 'LIDER_PRODUCTO',
  'FUNDACION', 'LIDER_FUNDACION',
  'B2B', 'GERENCIA'
])