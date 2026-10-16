import { hasSubmoduleOrRole } from '../../../shared/http/auth.middleware.js'
import { reconcileSheetSchema, applyFixesSchema } from './reconciliation.schemas.js'
import * as ctrl from './reconciliation.controller.js'
import { IMPORT_MODULE, SUB_CONCILIACION, SUB_CARGA } from '../importer.permissions.js'

// Conciliacion hoja FICO <-> sistema. Conciliar solo lee, pero expone montos y
// pagos de todos los alumnos de la hoja: submodulo propio en la matriz de
// permisos. Corregir ESCRIBE inscripciones y pagos: pide ademas el permiso de
// CARGA (el mismo que importar). La autenticacion la pone el plugin padre.
const CAN_RECONCILE = hasSubmoduleOrRole(IMPORT_MODULE, SUB_CONCILIACION, ['ADMIN'])
const CAN_IMPORT = hasSubmoduleOrRole(IMPORT_MODULE, SUB_CARGA, ['ADMIN'])

export default async function reconciliationRoutes (fastify) {
  fastify.post('/reconciliation', { preHandler: CAN_RECONCILE, schema: reconcileSheetSchema }, ctrl.reconcileSheetHandler)
  fastify.post('/reconciliation/fixes', { preHandler: [CAN_RECONCILE, CAN_IMPORT], schema: applyFixesSchema }, ctrl.applyFixesHandler)
}
