// Sondeo de solo lectura de la parte financiera de un enrollment (venta, cuotas, pagos, historial).
// Uso: node scripts/probe-enrollment-finanzas.mjs <enrollmentId>   (desde Backend/, lee la BD del DATABASE_URL)
import { q, pool } from './db.mjs'

const ID = Number(process.argv[2])
if (!ID) throw new Error("Uso: node scripts/probe-enrollment-finanzas.mjs <enrollmentId>")

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)
const dump = async (titulo, sql) => console.log(`\n== ${titulo}`, JSON.stringify((await q(sql, [ID])).rows, null, 1))

await dump('enrollment', `
  SELECT cp.alias AS plan_alias, e.*
    FROM enrollments e LEFT JOIN catalog cp ON cp.catalog_id = e.cat_payment_plan
   WHERE e.enrollment_id = $1`)
await dump('cuotas', `
  SELECT cs.alias AS estado, pi.*
    FROM payment_installments pi LEFT JOIN catalog cs ON cs.catalog_id = pi.cat_status
   WHERE pi.enrollment_id = $1 ORDER BY pi.installment_number`)
await dump('pagos', 'SELECT * FROM payments WHERE enrollment_id = $1 ORDER BY payment_date, payment_id')
await dump('descuentos', 'SELECT * FROM enrollment_discounts WHERE enrollment_id = $1')
await dump('audit (ultimos 5)', 'SELECT * FROM enrollment_audit_log WHERE enrollment_id = $1 ORDER BY 1 DESC LIMIT 5')

await pool.end()
