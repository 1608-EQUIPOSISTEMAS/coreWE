import fs from 'node:fs'
import pg from 'pg'
const url = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim().replace(/^#\s*/, ''))
  .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432'))?.slice('DATABASE_URL='.length)
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000 })

const { rows: ult } = await pool.query(
  `SELECT email_log_id, enrollment_id, to_email, template_type, status, sent_at, delivered_at, bounced_at, bounce_reason
     FROM email_logs ORDER BY email_log_id DESC LIMIT 25`)
console.log('== ULTIMOS 25 ENVIOS =='); console.table(ult)

const { rows: agg } = await pool.query(`
  SELECT status, COUNT(*) AS n,
         COUNT(delivered_at) AS con_delivered,
         COUNT(bounced_at) AS con_bounce,
         COUNT(opened_at) AS con_open,
         MIN(sent_at) AS desde, MAX(sent_at) AS hasta
    FROM email_logs GROUP BY status ORDER BY n DESC`)
console.log('== AGREGADO POR STATUS =='); console.table(agg)

const { rows: fails } = await pool.query(`
  SELECT email_log_id, enrollment_id, to_email, template_type, status, sent_at
    FROM email_logs WHERE status <> 'sent' ORDER BY email_log_id DESC LIMIT 15`)
console.log('== NO-SENT RECIENTES =='); console.table(fails)

await pool.end()
