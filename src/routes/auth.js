// src/routes/auth.js
import authService from '../services/auth.service.js'

export default async function authRoutes (fastify) {
  
  // Endpoint de Login
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'], // Campos obligatorios
        additionalProperties: false,
        properties: {
          username: { type: 'string' }, // Mapea a 'alias' en tu BD
          password: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const { username, password } = req.body
      
      console.log("data 1")
      const { user } = await authService.login({ username, password })
      
      const token = 'simulacion_de_token_jwt_xyz'
      console.log("data 2") 

      // 3. Responder
      return reply.code(200).send({
        ok: true,
        data: {
          token,
          user
        }
      })

    } catch (error) {
      // Manejo de error si credenciales fallan
      return reply.code(401).send({ 
        ok: false, 
        message: 'Usuario o contraseña incorrectos' 
      })
    }
  })

  //userlist
  fastify.post('/userlist', async (req, reply) => {
    try {
      const data = await authService.userList()
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
  
}