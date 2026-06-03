import { authenticate } from '../../shared/http/auth.middleware.js'
import { notificationListSchema, notificationPushRestrictionsSchema } from './notification.schemas.js'
import { startNotificationListener } from './notification.usecases.js'
import * as ctrl from './notification.controller.js'

export default async function notificationRoutes (fastify) {
  // Arranca el listener de NOTIFY de Postgres de forma explicita al registrar el
  // modulo, en lugar del efecto secundario en import del codigo legacy.
  startNotificationListener()

  fastify.get('/notifications/stream', { onRequest: [authenticate] }, ctrl.streamHandler)
  fastify.get('/notifications', { onRequest: [authenticate] }, ctrl.bellHandler)
  fastify.get('/notifications/count', { onRequest: [authenticate] }, ctrl.countHandler)
  fastify.patch('/notifications/mark-read', { onRequest: [authenticate] }, ctrl.markReadHandler)
  fastify.post('/notifications/list', { schema: notificationListSchema, onRequest: [authenticate] }, ctrl.listHandler)
  fastify.post('/notifications/push-restrictions-update', { schema: notificationPushRestrictionsSchema, onRequest: [authenticate] }, ctrl.pushRestrictionsHandler)
}
