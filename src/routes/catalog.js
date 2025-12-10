// src/routes/catalog.js
import { getCatalog } from '../services/catalog.service.js'

async function catalogRoutes (fastify) {
  fastify.post('/cataloglist', async (req, reply) => {
    try {
      const data = await getCatalog()
      return { ok: true, data }
    } catch (err) {
      fastify.log.error(err)
      return reply.code(500).send({ ok: false, message: 'Error obteniendo mapa de catálogos' })
    }
  })
  
}
export default catalogRoutes
