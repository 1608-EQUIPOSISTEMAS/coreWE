import { authenticate, ADMIN_ONLY } from '../../shared/http/auth.middleware.js'
import * as ctrl from './importer.controller.js'

// Rutas del modulo de importacion masiva. Toda la superficie es solo-ADMIN
// (vive bajo Administracion). Los endpoints de archivo no declaran schema
// AJV: @fastify/multipart parsea el body manualmente (igual que edition).
export default async function importerRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', ADMIN_ONLY)

  // Selector de entidades importables.
  fastify.get('/entities', ctrl.entitiesHandler)

  // Descarga de la plantilla Excel de una entidad.
  fastify.get('/:entity/template', ctrl.templateHandler)

  // Dry-run: valida el archivo y devuelve el reporte por fila (sin escribir).
  fastify.post('/:entity/validate', ctrl.validateHandler)

  // Confirma: importa las filas validas y reporta el resultado por fila.
  fastify.post('/:entity/commit', ctrl.commitHandler)

  // Variantes por URL de Google Sheet (body JSON { url }).
  fastify.post('/:entity/validate-url', ctrl.validateUrlHandler)
  fastify.post('/:entity/commit-url', ctrl.commitUrlHandler)

  // Progreso de una importacion en curso (polling del frontend): { done, total }.
  fastify.get('/progress/:jobId', ctrl.progressHandler)
}
