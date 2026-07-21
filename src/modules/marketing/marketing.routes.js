import { authenticate } from '../../shared/http/auth.middleware.js'
import { ingresosB2CHandler } from './marketing.controller.js'
import {
  listSocialPostsHandler, createSocialPostHandler, updateSocialPostHandler,
  deleteSocialPostHandler, syncSocialPostsHandler
} from './social.controller.js'

export default async function marketingRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)
  fastify.post('/ingresos-b2c', ingresosB2CHandler)

  // Publicaciones RRSS (IG / LinkedIn)
  fastify.get('/social-posts', listSocialPostsHandler)
  fastify.post('/social-posts', createSocialPostHandler)
  fastify.put('/social-posts/:id', updateSocialPostHandler)
  fastify.delete('/social-posts/:id', deleteSocialPostHandler)
  fastify.post('/social-posts/sync', syncSocialPostsHandler)
}
