// src/routes/auth.js
import authService from '../services/auth.service.js'
import { authenticate, ADMIN_ONLY, ALL_INTERNAL } from '../middlewares/auth.hooks.js'

import {
  loginSchema
} from '../models/auth.schema.js'

export default async function authRoutes (fastify) {

  // Público — aquí se genera el token, no puede llevar authenticate
  fastify.post('/login', {
    schema: loginSchema
  }, async (req, reply) => {
    try {
      const { username, password } = req.body
      const { user } = await authService.login({ username, password })

      const token = fastify.jwt.sign({
        id: user.user_id,
        username: user.alias,
        roles: user.roles
      }, {
        expiresIn: '12h'
      })

      return reply.code(200).send({
        ok: true,
        data: { token, user }
      })

    } catch (error) {
      return reply.code(401).send({
        ok: false,
        message: 'Usuario o contraseña incorrectos'
      })
    }
  })

  
  fastify.post('/userlist', { preHandler: [authenticate, ALL_INTERNAL] }, async (req, reply) => {
    try {
      const data = await authService.userList()
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

}