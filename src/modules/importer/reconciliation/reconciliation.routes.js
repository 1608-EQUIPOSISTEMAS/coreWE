import { hasSubmoduleOrRole } from '../../../shared/http/auth.middleware.js'
import { reconcileSheetSchema } from './reconciliation.schemas.js'
import * as ctrl from './reconciliation.controller.js'
import { IMPORT_MODULE, SUB_CONCILIACION } from '../importer.permissions.js'

// Conciliacion hoja FICO <-> sistema. Solo lectura, pero expone montos y pagos
// de todos los alumnos de la hoja: submodulo propio en la matriz de permisos.
// La autenticacion la pone el plugin padre (importer.routes).
const CAN_RECONCILE = hasSubmoduleOrRole(IMPORT_MODULE, SUB_CONCILIACION, ['ADMIN'])

export default async function reconciliationRoutes (fastify) {
  fastify.post('/reconciliation', { preHandler: CAN_RECONCILE, schema: reconcileSheetSchema }, ctrl.reconcileSheetHandler)
}
