// One-off: estado real del caso reportado (lead 430165 / enrollment 18729) y
// confirmacion de que el SP de esta BD ya trae el bloque [SUBSANAR].
import { q, pool } from './db.mjs'

const { rows: [db] } = await q('SELECT current_database() AS n, inet_server_port() AS p')
console.log(`BD: ${db.n}:${db.p}`)

const { rows } = await q(
  `SELECT l.lead_id, l.enrollment_id, e.cat_fico_status, c.alias AS fico_status
     FROM leads l
     LEFT JOIN enrollments e ON e.enrollment_id = l.enrollment_id
     LEFT JOIN catalog c ON c.catalog_id = e.cat_fico_status
    WHERE l.lead_id = 430165`
)
console.log(rows)

const { rows: [sp] } = await q(
  `SELECT position('[SUBSANAR]' in pg_get_functiondef(p.oid)) > 0 AS tiene_subsanar
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='sp_comercial_lead_update'`
)
console.log('SP con bloque [SUBSANAR]:', sp?.tiene_subsanar)
await pool.end()
