// src/routes/catalog.js
import { getCatalog, getMembershipList } from '../services/catalog.service.js'

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
  
  fastify.post('/membershiplist', async (req, reply) => {
    try {
      // Extraemos los filtros del body
      const { active, q, page, size } = req.body || {};

      const data = await getMembershipList({ active, q, page, size });

      // Estructura de respuesta estándar
      return { 
        ok: true, 
        data: data // data será un array de objetos con las columnas del SP
      }

    } catch (err) {
      fastify.log.error(err)
      return reply.code(500).send({ 
        ok: false, 
        message: 'Error obteniendo lista de membresías' 
      })
    }
  })
}
export default catalogRoutes
