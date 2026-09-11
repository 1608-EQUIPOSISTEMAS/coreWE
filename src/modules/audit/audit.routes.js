import { authenticate } from '../../shared/http/auth.middleware.js'
import { auditLogListSchema, auditSystemActionSchema } from './audit.schemas.js'
import * as ctrl from './audit.controller.js'

export default async function auditRoutes (fastify) {
  // Sin gate de rol en el preHandler a propósito: quién entra y qué alcance
  // tiene es la MISMA decisión (auditableRolesFor), y vive en la entity. Un
  // hasRole aquí sería una segunda lista de roles que mantener en sincronía.
  fastify.post('/loglist', { schema: auditLogListSchema, preHandler: [authenticate] }, ctrl.auditLogListHandler)

  // Escribe, no lee: cualquier usuario autenticado deja huella de SU propia
  // acción de menú. Leer la bitácora sigue siendo cosa de ADMIN y líderes.
  fastify.post('/action', { schema: auditSystemActionSchema, preHandler: [authenticate] }, ctrl.systemActionHandler)
}
