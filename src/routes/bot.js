import botService from '../services/bot.service.js'
import { authenticate, ALL_ACADEMICA } from '../middlewares/auth.hooks.js'
import {
  botTicketListSchema,
  botTicketGetSchema,
  botTicketUpdateSchema,
  botDashboardMetricsSchema,
  botStudentListSchema,
  botStudentGetSchema
} from '../models/bot.schema.js'

export default async function botRoutes(fastify) {

  // Lista de Tickets
  fastify.post('/botticketlist', {
    schema: botTicketListSchema,
    preHandler: [authenticate, ALL_ACADEMICA] // <-- Ajusta el rol según tu negocio
  }, async (req, reply) => {
    const data = await botService.botTicketList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // Detalle de un Ticket
  fastify.post('/botticketget', {
    schema: botTicketGetSchema,
    preHandler: [authenticate, ALL_ACADEMICA]
  }, async (req, reply) => {
    const { data } = await botService.botTicketGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // Actualizar Ticket (Marcar Solucionado, añadir notas)
  fastify.post('/botticketupdate', {
    schema: botTicketUpdateSchema,
    preHandler: [authenticate, ALL_ACADEMICA]
  }, async (req, reply) => {
    // Inyectamos el ID del usuario logueado desde el token (suponiendo que req.user existe por tu middleware)
    const payload = {
      ...req.body,
      current_user_id: req.user?.id || req.body.user_id 
    }
    
    const result = await botService.botTicketUpdate(payload)
    return reply.code(200).send({ ok: true, data: result })
  })

  // KPIs y Dashboard
  fastify.post('/botdashboardmetrics', {
    schema: botDashboardMetricsSchema,
    preHandler: [authenticate, ALL_ACADEMICA]
  }, async (req, reply) => {
    const { data } = await botService.botDashboardMetricsGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // Listar Alumnos
  fastify.post('/botstudentlist', {
    schema: botStudentListSchema,
    preHandler: [authenticate, ALL_ACADEMICA]
  }, async (req, reply) => {
    const data = await botService.botStudentList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // Obtener Perfil del Alumno
  fastify.post('/botstudentget', {
    schema: botStudentGetSchema,
    preHandler: [authenticate, ALL_ACADEMICA]
  }, async (req, reply) => {
    const { data } = await botService.botStudentGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // Listar CSAT
  fastify.post('/botcsatlist', {
    preHandler: [authenticate, ALL_ACADEMICA]
  }, async (req, reply) => {
    const data = await botService.botCsatList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

}