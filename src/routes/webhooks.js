import { pool } from '../config/db.js'

// Idempotencia in-memory: ZeptoMail puede reintentar el mismo evento si su
// servidor no recibe 2xx. Sin esto, cada reintento aplica el UPDATE otra vez
// (open_count++ duplicado, etc). TTL 1h cubre la ventana razonable de retries.
const processedEvents = new Map() // key: `${messageId}:${eventType}` -> timestamp
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000

function isProcessed (key) {
  const ts = processedEvents.get(key)
  if (!ts) return false
  if (Date.now() - ts > IDEMPOTENCY_TTL_MS) {
    processedEvents.delete(key)
    return false
  }
  return true
}

function markProcessed (key) {
  processedEvents.set(key, Date.now())
  if (processedEvents.size > 5000) {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS
    for (const [k, ts] of processedEvents) {
      if (ts < cutoff) processedEvents.delete(k)
    }
  }
}

export default async function webhookRoutes (fastify) {

  fastify.post('/zeptomail', {
    config: { rawBody: true }
  }, async (req, reply) => {
    // Defensa primaria sin HMAC: si hay token compartido configurado, exigirlo.
    // ZeptoMail permite custom headers; cuando se configure, este check rechaza
    // peticiones falsificadas. Si no esta seteado, el endpoint queda abierto
    // como antes (compat) pero se loguea warning.
    const expectedToken = process.env.ZEPTOMAIL_WEBHOOK_TOKEN
    if (expectedToken) {
      const sent = req.headers['x-webhook-token']
      if (sent !== expectedToken) {
        return reply.code(401).send({ ok: false, message: 'Invalid webhook token' })
      }
    } else {
      req.log.warn('Webhook ZeptoMail sin ZEPTOMAIL_WEBHOOK_TOKEN configurado - aceptando sin verificar')
    }

    const events = Array.isArray(req.body) ? req.body : [req.body]

    for (const event of events) {
      const messageId = event.message_id || event.reference || null
      const eventType = (event.event_type || event.type || '').toLowerCase()

      if (!messageId) continue

      const idemKey = `${messageId}:${eventType}`
      if (isProcessed(idemKey)) continue

      try {
        const now = new Date()

        if (eventType === 'delivered' || eventType === 'delivery') {
          await pool.query(`
            UPDATE email_logs SET status = 'delivered', delivered_at = $1, last_event_at = $1
            WHERE message_id = $2 AND delivered_at IS NULL
          `, [now, messageId])
        } else if (eventType === 'opened' || eventType === 'open') {
          await pool.query(`
            UPDATE email_logs SET status = 'opened', opened_at = COALESCE(opened_at, $1),
              open_count = open_count + 1, last_event_at = $1
            WHERE message_id = $2
          `, [now, messageId])
        } else if (eventType === 'clicked' || eventType === 'click') {
          await pool.query(`
            UPDATE email_logs SET status = 'clicked', clicked_at = COALESCE(clicked_at, $1),
              click_count = click_count + 1, last_event_at = $1
            WHERE message_id = $2
          `, [now, messageId])
        } else if (eventType === 'bounced' || eventType === 'hard_bounce' || eventType === 'soft_bounce') {
          await pool.query(`
            UPDATE email_logs SET status = 'bounced', bounced_at = $1, last_event_at = $1,
              bounce_reason = $3
            WHERE message_id = $2
          `, [now, messageId, event.reason || event.bounce_reason || eventType])
        }
        markProcessed(idemKey)
      } catch (err) {
        req.log.error({ err, messageId, eventType }, 'Webhook ZeptoMail error procesando evento')
      }
    }

    return reply.code(200).send({ ok: true })
  })
}
