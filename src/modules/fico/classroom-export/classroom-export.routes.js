import { authenticate } from '../../../shared/http/auth.middleware.js'
import { exportClassroomSchema } from './classroom-export.schemas.js'
import * as ctrl from './classroom-export.controller.js'

// Rutas de la exportacion del aula virtual. Reporteria de solo lectura: basta
// estar autenticado, sin gate de rol (paridad con el legacy en routes/fico.js).
// Se registran bajo el prefijo /api/fico para reproducir las URLs originales.
export default async function classroomExportRoutes (fastify) {
  fastify.get('/classroomexport/options', { preHandler: [authenticate] }, ctrl.optionsHandler)
  fastify.get('/classroomexport', { preHandler: [authenticate], schema: exportClassroomSchema }, ctrl.exportHandler)
}
