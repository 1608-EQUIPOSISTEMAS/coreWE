import pg from 'pg'
import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'
import { parseNotificationPayload, buildSseEventData } from './notification.entity.js'

// Persistencia y canal en tiempo real del dominio notification.
// Reune el acceso a la tabla notifications, el SP de listado paginado y el
// broker SSE (registro de clientes conectados + escucha de NOTIFY de Postgres).
export class NotificationRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
    // Registro de conexiones SSE vivas indexado por userId.
    this.sseClients = new Map()
    // Estado del listener de Postgres para reconexion con backoff acotado.
    this.listenerStarted = false
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = Number(process.env.NOTIFY_MAX_RETRIES ?? 10)
    this.reconnectBaseMs = Number(process.env.NOTIFY_RECONNECT_BASE_MS ?? 5000)
  }

  async getUnreadNotifications (userId) {
    const result = await this.db.query(`
    (
      SELECT notification_id, lead_id, title, message, is_read, read_at, created_at
      FROM public.notifications
      WHERE user_id = $1 AND is_read = false
      ORDER BY created_at DESC
    )
    UNION ALL
    (
      SELECT notification_id, lead_id, title, message, is_read, read_at, created_at
      FROM public.notifications
      WHERE user_id = $1 AND is_read = true
      ORDER BY created_at DESC
      LIMIT 5
    )
    ORDER BY created_at DESC
  `, [userId])
    return result.rows
  }

  async countUnreadNotifications (userId) {
    const result = await this.db.query(`
    SELECT COUNT(*) AS unread_count
    FROM public.notifications
    WHERE user_id = $1 AND is_read = false
  `, [userId])
    return parseInt(result.rows[0].unread_count)
  }

  async markAllAsRead (userId) {
    await this.db.query(`
    UPDATE public.notifications
    SET is_read = true,
        read_at = NOW()       -- ← aquí se guarda el momento exacto
    WHERE user_id = $1 AND is_read = false
  `, [userId])
  }

  async list (filters) {
    return this.sp(this.db, 'public.sp_notification_list', [JSON.stringify(filters)])
  }

  // Registra una conexion SSE para un usuario y devuelve un descarte idempotente.
  addClient (userId, reply) {
    if (!this.sseClients.has(userId)) this.sseClients.set(userId, new Set())
    this.sseClients.get(userId).add(reply)
    return () => this.sseClients.get(userId)?.delete(reply)
  }

  // Empuja datos SSE ya serializados a todas las conexiones vivas de un usuario.
  // Devuelve true si habia al menos una conexion a la que escribir.
  pushTo (userId, eventData) {
    const clients = this.sseClients.get(userId)
    if (!clients || clients.size === 0) return false
    for (const reply of clients) reply.raw.write(eventData)
    return true
  }

  // Inicia el listener de canal_crm_notificaciones una sola vez. Reenvia cada
  // NOTIFY al cliente SSE correspondiente y reconecta con backoff exponencial y
  // jitter, acotado por maxReconnectAttempts.
  async startPgListener () {
    if (this.listenerStarted) return
    this.listenerStarted = true

    const isSSL = process.env.DATABASE_SSL?.toLowerCase() === 'true'
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL_DIRECT,
      ssl: isSSL ? { rejectUnauthorized: false } : false
    })

    try {
      await client.connect()
      await client.query('LISTEN canal_crm_notificaciones')
      this.reconnectAttempts = 0
      console.log('[NOTIFY] Escuchando canal_crm_notificaciones...')
    } catch (err) {
      console.error('[NOTIFY] No se pudo iniciar el listener:', err.message)
      this.listenerStarted = false
      this.scheduleReconnect()
      return
    }

    client.on('notification', (msg) => {
      console.log('[NOTIFY] ► Mensaje recibido desde pg:', msg.payload)
      try {
        const payload = parseNotificationPayload(msg.payload)
        const asesor_id = payload.asesor_id

        console.log('[NOTIFY] asesor_id:', asesor_id, '| clientes activos:', [...this.sseClients.keys()])

        const sent = this.pushTo(asesor_id, buildSseEventData(payload))
        if (sent) {
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
      this.listenerStarted = false
      this.scheduleReconnect()
    })
  }

  // Programa un reintento de conexion con backoff exponencial y jitter, dejando
  // de reintentar al superar el maximo configurado para no inundar los logs.
  scheduleReconnect () {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[NOTIFY] Reintentos agotados (${this.maxReconnectAttempts}); listener detenido.`)
      return
    }
    this.reconnectAttempts += 1
    const exp = this.reconnectBaseMs * Math.pow(2, this.reconnectAttempts - 1)
    const jitter = Math.floor(Math.random() * this.reconnectBaseMs)
    setTimeout(() => this.startPgListener(), exp + jitter)
  }
}

export const notificationRepository = new NotificationRepository()
