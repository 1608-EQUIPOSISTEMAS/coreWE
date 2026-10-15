import { authenticate, hasSubmoduleOrRole } from '../../shared/http/auth.middleware.js'
import * as ctrl from './importer.controller.js'
import reconciliationRoutes from './reconciliation/reconciliation.routes.js'
import { IMPORT_MODULE, SUB_CARGA } from './importer.permissions.js'

// Rutas del modulo Importacion (grupo propio en el sidebar). Cada submodulo es
// un permiso distinto de la matriz (Configuracion > Roles y Permisos):
//   - CARGA: importar hojas. ESCRIBE inscripciones y pagos.
//   - CONCILIACION: comparar una hoja contra el sistema. Solo lectura.
// Fuera de ADMIN, el acceso se otorga por la matriz, no por roles fijos.
// Los endpoints de archivo no declaran schema AJV: @fastify/multipart parsea
// el body manualmente (igual que edition).
const CAN_IMPORT = hasSubmoduleOrRole(IMPORT_MODULE, SUB_CARGA, ['ADMIN'])

export default async function importerRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  // Selector de entidades importables.
  fastify.get('/entities', { preHandler: CAN_IMPORT }, ctrl.entitiesHandler)

  // Descarga de la plantilla Excel de una entidad.
  fastify.get('/:entity/template', { preHandler: CAN_IMPORT }, ctrl.templateHandler)

  // Dry-run: valida el archivo y devuelve el reporte por fila (sin escribir).
  fastify.post('/:entity/validate', { preHandler: CAN_IMPORT }, ctrl.validateHandler)

  // Confirma: importa las filas validas y reporta el resultado por fila.
  fastify.post('/:entity/commit', { preHandler: CAN_IMPORT }, ctrl.commitHandler)

  // Variantes por URL de Google Sheet (body JSON { url }).
  fastify.post('/:entity/validate-url', { preHandler: CAN_IMPORT }, ctrl.validateUrlHandler)
  fastify.post('/:entity/commit-url', { preHandler: CAN_IMPORT }, ctrl.commitUrlHandler)

  // Progreso de una importacion en curso (polling del frontend): { done, total }.
  fastify.get('/progress/:jobId', { preHandler: CAN_IMPORT }, ctrl.progressHandler)

  // Conciliacion hoja <-> sistema (submodulo CONCILIACION, gate propio).
  await fastify.register(reconciliationRoutes)
}
