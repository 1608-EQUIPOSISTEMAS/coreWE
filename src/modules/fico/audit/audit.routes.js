import { authenticate } from '../../../shared/http/auth.middleware.js'
import { getAuditLogSchema } from './audit.schemas.js'
import * as ctrl from './audit.controller.js'

// Rutas del log de auditoria FICO. La consulta de la timeline solo exige sesion
// (sin gate de rol), coherente con el legacy que no aplicaba hasRole; se agrega
// authenticate para no exponer la bitacora a peticiones anonimas.
export default async function auditRoutes (fastify) {
  fastify.post('/auditlog', { preHandler: [authenticate], schema: getAuditLogSchema }, ctrl.getAuditLogHandler)
}
