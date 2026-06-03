import * as usecases from './notification.usecases.js'
import { notificationRepository } from './notification.repository.js'

// Canal SSE por usuario. Mantiene la conexion abierta, envia heartbeats y
// registra/descarta la conexion en el broker al conectar y al cerrar.
export async function streamHandler (req, reply) {
  const userId = Number(req.user.id)
  console.log(`[SSE] ► Usuario conectado | userId: ${userId}`)

  reply.raw.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.setHeader('X-Accel-Buffering', 'no')
  reply.raw.flushHeaders()

  const removeClient = notificationRepository.addClient(userId, reply)
  console.log(`[SSE] Total conexiones userId=${userId}: ${notificationRepository.sseClients.get(userId).size}`)

  const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 30000)

  req.raw.on('close', () => {
    clearInterval(heartbeat)
    removeClient()
    console.log(`[SSE] Usuario ${userId} desconectado.`)
  })

  await new Promise((resolve) => req.raw.on('close', resolve))
}

export async function bellHandler (req, reply) {
  const data = await usecases.getBellNotifications(req.user.id)
  return reply.code(200).send({ ok: true, data })
}

export async function countHandler (req, reply) {
  const unread_count = await usecases.getUnreadCount(req.user.id)
  return reply.code(200).send({ ok: true, data: { unread_count } })
}

export async function markReadHandler (req, reply) {
  await usecases.markAllRead(req.user.id)
  return reply.code(200).send({ ok: true })
}

export async function listHandler (req, reply) {
  const data = await usecases.listNotifications({
    user_id: req.user.id,
    page: req.body?.page ?? 1,
    size: req.body?.size ?? 20,
    is_read: req.body?.is_read ?? undefined
  })
  return reply.code(200).send({ ok: true, data })
}

export async function pushRestrictionsHandler (req, reply) {
  const { notificados } = await usecases.pushRestrictionsUpdate(req.body?.user_ids)
  return reply.code(200).send({ ok: true, notificados })
}
