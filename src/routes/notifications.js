// src/routes/notifications.js
import pg from 'pg'
import { pool } from '../config/db.js'
import notificationService from '../services/notification.service.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

export const sseClients = new Map() 

async function startPgListener() {
  const isSSL = process.env.DATABASE_SSL?.toLowerCase() === 'true';
  const client = new pg.Client({ 
    connectionString: process.env.DATABASE_URL_DIRECT, 
    ssl: isSSL ? { rejectUnauthorized: false } : false 
  });
  await client.connect();
  await client.query('LISTEN canal_crm_notificaciones');
  console.log('[NOTIFY] Escuchando canal_crm_notificaciones...');

  client.on('notification', (msg) => {
    console.log('[NOTIFY] ► Mensaje recibido desde pg:', msg.payload)
    try {
      const payload = JSON.parse(msg.payload)
      const asesor_id = Number(payload.asesor_id)

      console.log('[NOTIFY] asesor_id:', asesor_id, '| clientes activos:', [...sseClients.keys()])

      const clients = sseClients.get(asesor_id)
      if (clients && clients.size > 0) {
        const eventData = `data: ${JSON.stringify(payload)}\n\n`
        for (const reply of clients) reply.raw.write(eventData)
        console.log(`[NOTIFY] ✅ Evento enviado a asesor_id=${asesor_id}`)
      } else {
        console.log(`[NOTIFY] ⚠️  Sin clientes SSE para asesor_id=${asesor_id}`)
      }
    } catch (err) {
      console.error('[NOTIFY] Error:', err.message)
    }
  })

  client.on('error', (err) => {
    console.error('[NOTIFY] Conexión perdida, reconectando...', err.message)
    setTimeout(startPgListener, 5000)
  })
}

startPgListener()

export default async function notificationRoutes(fastify) {

  // SSE stream
  fastify.get('/notifications/stream', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    const userId = Number(req.user.id)
    console.log(`[SSE] ► Usuario conectado | userId: ${userId}`)

    // Todos los headers en un solo bloque — sin duplicados
    reply.raw.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    if (!sseClients.has(userId)) sseClients.set(userId, new Set())
    sseClients.get(userId).add(reply)
    console.log(`[SSE] Total conexiones userId=${userId}: ${sseClients.get(userId).size}`)

    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 30000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      sseClients.get(userId)?.delete(reply)
      console.log(`[SSE] Usuario ${userId} desconectado.`)
    })

    await new Promise((resolve) => req.raw.on('close', resolve))
  })

  // Campanita
  fastify.get('/notifications', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    try {
      const notifications = await notificationService.getUnreadNotifications(req.user.id)
      return reply.code(200).send({ ok: true, data: { notifications, unread_count: notifications.filter(n => !n.is_read).length } })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  // Conteo
  fastify.get('/notifications/count', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    try {
      const unread_count = await notificationService.countUnreadNotifications(req.user.id)
      return reply.code(200).send({ ok: true, data: { unread_count } })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  // Marcar leídas
  fastify.patch('/notifications/mark-read', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    try {
      await notificationService.markAllAsRead(req.user.id)
      return reply.code(200).send({ ok: true })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  // Módulo completo paginado
  fastify.post('/notifications/list', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    try {
      const filters = {
        user_id: req.user.id,
        page:    req.body?.page    ?? 1,
        size:    req.body?.size    ?? 20,
        is_read: req.body?.is_read ?? undefined
      }
      const rows = await callProcedureReturningRows(pool, 'public.sp_notification_list', [JSON.stringify(filters)])
      const total_count = rows?.[0]?.total_count ?? 0
      return reply.code(200).send({ ok: true, data: { rows, total_count } })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
  // Forzar recarga de restricciones a asesores específicos
fastify.post('/notifications/push-restrictions-update', { onRequest: [fastify.authenticate] }, async (req, reply) => {
  try {
    const { user_ids } = req.body // array de IDs de asesores afectados
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return reply.code(400).send({ ok: false, error: 'user_ids requerido' })
    }

    const eventData = `data: ${JSON.stringify({ tipo_evento: 'restricciones_actualizadas' })}\n\n`
    let notificados = 0

    for (const uid of user_ids) {
      const userId = Number(uid)
      const clients = sseClients.get(userId)
      if (clients && clients.size > 0) {
        for (const reply of clients) reply.raw.write(eventData)
        notificados++
        console.log(`[NOTIFY] ✅ restricciones_actualizadas → userId=${userId}`)
      } else {
        console.log(`[NOTIFY] ⚠️  Sin SSE activo para userId=${userId} (se aplicará al próximo login)`)
      }
    }

    return reply.code(200).send({ ok: true, notificados })
  } catch (err) {
    return reply.code(500).send({ ok: false, error: err.message })
  }
})
}