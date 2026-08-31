// Cuantas filas de la hoja "7. Convenios" cambian de ASESOR con el fix del token.
//   node scripts/probe-convenios-asesor-divergente.mjs [--prod]
import fs from 'fs'
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { pool } = await import('./db.mjs')

const { rows } = await pool.query(`
  SELECT e.enrollment_id,
         e.agent_origin,
         u.alias        AS seller_alias,
         ag_token.alias AS token_alias,
         to_char(COALESCE(l.pay_date::date, e.registration_date::date), 'DD/MM/YYYY') AS f_pago
    FROM enrollments e
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN users u ON u.user_id = e.seller_agent_id
    LEFT JOIN LATERAL (
      SELECT up.alias FROM payment_tokens pt
        LEFT JOIN users up ON up.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC LIMIT 1
    ) ag_token ON TRUE
   WHERE e.active = 'Y'
     AND (e.agent_origin ILIKE '%b2b%' OR e.b2b_contract_id IS NOT NULL OR l.b2b = 'Y')
     AND ag_token.alias IS NOT NULL
     AND ag_token.alias IS DISTINCT FROM u.alias
   ORDER BY e.enrollment_id
`)
console.log(`filas B2B donde el token manda distinto que el seller: ${rows.length}`)
for (const r of rows) {
  console.log(`  #${r.enrollment_id}  ${r.f_pago}  "${r.agent_origin} - ${r.seller_alias}"  ->  "${r.agent_origin} - ${r.token_alias}"`)
}
await pool.end()
