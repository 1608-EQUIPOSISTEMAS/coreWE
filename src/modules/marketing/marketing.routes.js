import { authenticate } from '../../shared/http/auth.middleware.js'
import { ALL_GERENCIA } from '../../middlewares/auth.hooks.js'
import { ingresosB2CHandler } from './marketing.controller.js'

// Lo que queda del viejo modulo Marketing: los submodulos de RRSS (Publicaciones
// y Crecimiento) se eliminaron el 2026-08-26. El unico endpoint vivo alimenta el
// "Reporte Completo" de Gerencia, por eso el gate es ALL_GERENCIA y no MARKETING.
export default async function marketingRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', ALL_GERENCIA)

  fastify.post('/ingresos-b2c', ingresosB2CHandler)
}
