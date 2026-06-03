import { authenticate } from '../../../shared/http/auth.middleware.js'
import { enrollInOdooSchema } from './odoo-sync.schemas.js'
import * as ctrl from './odoo-sync.controller.js'

// Rutas del sync Odoo de inscripciones. Solo requiere autenticacion (sin gate de
// rol), identico al endpoint legacy /fico/enrollinodoo.
export default async function odooSyncRoutes (fastify) {
  fastify.post('/enrollinodoo', { preHandler: [authenticate], schema: enrollInOdooSchema }, ctrl.enrollInOdooHandler)
}
