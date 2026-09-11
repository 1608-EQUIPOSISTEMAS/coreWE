// One-off: verificacion post-fix del enrollment 13986 (ver fix-13986-inicial-y-cuota.mjs).
import fs from 'node:fs'
import pg from 'pg'
const url = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim().replace(/^#\s*/, ''))
  .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432')).slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000 })
const q = async (t, p) => (await pool.query(t, p)).rows

console.log('CABECERA', await q(`SELECT enrollment_id, list_price, discount_amount, total_amount, cat_payment_plan FROM enrollments WHERE enrollment_id=13986`))
console.log('CUOTAS', await q(`SELECT installment_id, installment_number, amount, cat_status FROM payment_installments WHERE enrollment_id=13986 ORDER BY installment_number`))
console.log('PAGOS', await q(`SELECT payment_id, installment_id, amount, active, transaction_code FROM payments WHERE enrollment_id=13986 ORDER BY payment_id`))
console.log('MATVIEW', await q(`SELECT "ID","NOMBRES COMPLETOS","PRECIO LISTA","TOTAL A PAGAR","TOTAL DESCONTADO","RESERVA_AMOUNT","PAID_AMOUNT","PLAN DE CUOTAS","C1","C2" FROM mv_enrollment_report_system WHERE "ID"=13986`))
console.log('AUDITORIA', await q(`SELECT audit_id, action, justificacion, changes, details FROM enrollment_audit_log WHERE enrollment_id=13986 ORDER BY audit_id DESC LIMIT 1`))
await pool.end()
