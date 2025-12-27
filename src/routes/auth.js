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
    // auth.js
      try {
        const { username, password } = req.body
        const { user } = await authService.login({ username, password })

        // GENERAR EL TOKEN REAL
        const token = fastify.jwt.sign({ 
          id: user.user_id,        
          username: user.alias, 
          roles: user.roles      // <--- GUARDAMOS EL ARRAY (ej: ['ADMIN', 'VENTAS'])
        }, { 
          expiresIn: '12h'    
        })

        return reply.code(200).send({
          ok: true,
          data: {
            token,
            user // Enviamos el usuario completo al frontend para guardarlo en localStorage
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