import { pool } from '../config/db.js'

export default async function webhookRoutes (fastify) {

  fastify.post('/zeptomail', {
    config: { rawBody: true }
  }, async (req, reply) => {
    const events = Array.isArray(req.body) ? req.body : [req.body]

    for (const event of events) {
      const messageId = event.message_id || event.reference || null
      const eventType = (event.event_type || event.type || '').toLowerCase()

      if (!messageId) continue

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
      } catch (err) {
        console.error('[Webhook] Error procesando evento:', err.message)
      }
    }

    return reply.code(200).send({ ok: true })
  })
}
