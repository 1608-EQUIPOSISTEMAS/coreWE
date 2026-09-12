// Verifica el backfill del Match WEB en produccion y refresca la matview que
// lee el panel FICO (mv_enrollment_report_system).
import fs from 'fs'
import pg from 'pg'
const PROD_URL = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim()
const c = new pg.Client({ connectionString: PROD_URL, connectionTimeoutMillis: 15000, keepAlive: true })
await c.connect()

const { rows: [r] } = await c.query(`
  SELECT COUNT(*)                                              AS ventas_web_con_asesor,
         COUNT(l.lead_id)                                      AS con_consulta_enganchada,
         COUNT(*) FILTER (WHERE cs.alias = 'we_lead_status_bought') AS en_pago,
         COUNT(*) FILTER (WHERE l.lead_id IS NOT NULL AND l.pay_date IS NULL) AS sin_fecha_pago
    FROM enrollments e
    LEFT JOIN leads   l  ON l.enrollment_id = e.enrollment_id
    LEFT JOIN catalog cs ON cs.catalog_id   = l.cat_status_lead
   WHERE e.agent_origin = 'WEB' AND e.seller_agent_id IS NOT NULL AND e.active = 'Y'`)
console.table([r])

console.log('refrescando mv_enrollment_report_system...')
await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system')
console.log('OK: matview refrescada.')
await c.end()
