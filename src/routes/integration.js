
import integrationService from '../services/integration.service.js'

export default async function integrationRoutes (fastify) {

  // =================================================================
  // SINCRONIZACIÓN ODS -> GOOGLE SHEETS
  // =================================================================
  fastify.post('/syncleadstosheet',{
    schema: {
      body: {
        type: 'object',
        required: ['user_id'],
        additionalProperties: false,
        properties: {
          user_id: {
            type: 'integer',
            additionalProperties: true
          }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const result = await integrationService.syncLeadsToSheet(req.body)
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

    fastify.post('/syncInscToSheet',{
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: false,
        properties: {
          enrollment_id: {
            type: 'integer',
            additionalProperties: true
          }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const result = await integrationService.syncInscToSheet(req.body)
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
  
   fastify.post('/syncscheduletosheet', async (req, reply) => {
    try {
      const result = await integrationService.syncScheduleToSheet(req.body)
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
  
}
