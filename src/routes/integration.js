
import integrationService from '../services/integration.service.js'
import { authenticate } from '../middlewares/auth.hooks.js'

export default async function integrationRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

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

  //syncRprospectos
  fastify.post('/syncrprospectos', async (req, reply) => {
    try {
      const result = await integrationService.syncRprospectos()
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
  
  //syncRprospectos
  fastify.post('/syncEnrollmentToSheet', async (req, reply) => {
    try {
      const result = await integrationService.syncEnrollmentToSheet()
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  // FICO -> hoja "0. Ventas Sistemas"
  fastify.post('/syncFicoSalesToSheet', async (req, reply) => {
    try {
      const result = await integrationService.syncFicoSalesToSheet()
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  // FICO -> ambas hojas (Ventas + Aula) en una sola llamada
  fastify.post('/syncFicoToSheets', async (req, reply) => {
    try {
      const result = await integrationService.syncFicoToSheets()
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

// =================================================================
  // NOTIFICACIONES SLACK (CORREGIDO)
  // =================================================================
  fastify.post('/send-slack-report', {
    schema: {
      body: {
        type: 'object',
        required: ['titulo', 'texto'],
        additionalProperties: false,
        properties: {
          titulo: { type: 'string', minLength: 1 },
          texto: { type: 'string', minLength: 1 },
          imagenesUrls: { // <--- AQUÍ ESTABA EL ERROR
            type: 'array',
            items: { type: 'string' }, // <--- Quitamos "format: uri"
            default: []
          },
          // Opcional: Si quieres ser más semántico, puedes renombrarlo a "imagenes"
          // pero si lo cambias aquí, recuerda cambiarlo en el JSON que envías.
        }
      }
    }
  }, async (req, reply) => {
    try {
      // Mapeamos 'imagenesUrls' a 'imagenes' para que coincida con tu servicio nuevo
      const payload = {
          ...req.body,
          imagenes: req.body.imagenesUrls 
      }
      
      const result = await integrationService.sendReportToSlack(payload)
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
  
}