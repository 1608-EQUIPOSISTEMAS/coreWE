// Montos del destino de CC 15905 y de su origen 3589, para decidir si el total
// del destino debe subir con la cuota nueva.
//   node scripts/probe-15905-montos.mjs
import { q, pool } from './db.mjs'

const e = await q(`SELECT enrollment_id, list_price, total_amount, discount_amount, cat_currency,
                          cat_payment_plan, cat_type_status
                     FROM enrollments WHERE enrollment_id = ANY($1) ORDER BY enrollment_id`, [[3589, 15905]])
console.table(e.rows)

const cu = await q(`SELECT enrollment_id, installment_id, installment_number, amount, due_date, cat_status
                      FROM payment_installments WHERE enrollment_id = ANY($1)
                     ORDER BY enrollment_id, installment_number`, [[3589, 15905]])
console.table(cu.rows)

const pa = await q(`SELECT enrollment_id, payment_id, amount, payment_date, installment_id, active
                      FROM payments WHERE enrollment_id = ANY($1) ORDER BY enrollment_id, payment_id`, [[3589, 15905]])
console.table(pa.rows)

await pool.end()
