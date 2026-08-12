import { authenticate } from '../../shared/http/auth.middleware.js'
import { ALL_MARKETING } from '../../middlewares/auth.hooks.js'
import { ingresosB2CHandler } from './marketing.controller.js'
import {
  listSocialPostsHandler, createSocialPostHandler, updateSocialPostHandler,
  deleteSocialPostHandler, syncSocialPostsHandler
} from './social.controller.js'
import {
  listSocialAccountsHandler, listSocialGrowthHandler,
  saveSocialGrowthHandler, syncSocialGrowthHandler
} from './growth.controller.js'
import {
  socialAccountListSchema, socialGrowthListSchema,
  socialGrowthSaveSchema, socialGrowthSyncSchema
} from './growth.schemas.js'

export default async function marketingRoutes (fastify) {
  // El gate de módulo va junto al de autenticación: hasta ahora estas rutas solo
  // pedían estar logueado, así que cualquier usuario del ERP —un docente, un
  // asesor— podía leer y borrar publicaciones por API. El bloqueo era solo de UI.
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', ALL_MARKETING)

  fastify.post('/ingresos-b2c', ingresosB2CHandler)

  // Publicaciones RRSS (IG / LinkedIn)
  fastify.get('/social-posts', listSocialPostsHandler)
  fastify.post('/social-posts', createSocialPostHandler)
  fastify.put('/social-posts/:id', updateSocialPostHandler)
  fastify.delete('/social-posts/:id', deleteSocialPostHandler)
  fastify.post('/social-posts/sync', syncSocialPostsHandler)

  // Crecimiento RRSS (seguidores por marca y red)
  fastify.get('/social-accounts', { schema: socialAccountListSchema }, listSocialAccountsHandler)
  fastify.get('/social-growth', { schema: socialGrowthListSchema }, listSocialGrowthHandler)
  fastify.put('/social-growth', { schema: socialGrowthSaveSchema }, saveSocialGrowthHandler)
  fastify.post('/social-growth/sync', { schema: socialGrowthSyncSchema }, syncSocialGrowthHandler)
}
