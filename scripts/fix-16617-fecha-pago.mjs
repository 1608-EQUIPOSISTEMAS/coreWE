// One-off 2026-08-18: el enrollment 16617 quedó con F.PAGO 18/08 y debía ser 17/08.
// Se corrigen las DOS puntas de la cascada F.PAGO (leads.pay_date gana sobre payments):
// ver memoria "leads pay_date cascada". Idempotente: solo mueve lo que aún dice 18/08.
import { q, pool } from './db.mjs'

const ID = 16617
const DE = '2026-08-18'
const A = '2026-08-17'

const antes = await q(
  `SELECT p.payment_id, p.payment_date, l.lead_id, l.pay_date
     FROM payments p
     FULL JOIN leads l ON l.enrollment_id = $1
    WHERE p.enrollment_id = $1`, [ID])
console.log('ANTES:', antes.rows)

// Se conserva la hora original: solo se retrocede el día.
const pagos = await q(
  `UPDATE payments SET payment_date = payment_date - INTERVAL '1 day'
    WHERE enrollment_id = $1 AND payment_date::date = $2::date
    RETURNING payment_id, payment_date`, [ID, DE])
console.log('pagos movidos:', pagos.rows)

const lead = await q(
  `UPDATE leads SET pay_date = $2::date, user_modification_id = 9
    WHERE enrollment_id = $1 AND pay_date IS DISTINCT FROM $2::date
    RETURNING lead_id, pay_date`, [ID, A])
console.log('lead sincronizado:', lead.rows)

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')

const despues = await q(
  `SELECT p.payment_id, p.payment_date, l.lead_id, l.pay_date,
          m.enrollment_id, m.payment_date AS mv_payment_date
     FROM payments p
     FULL JOIN leads l ON l.enrollment_id = $1
     LEFT JOIN mv_enrollment_report_system m ON m.enrollment_id = $1
    WHERE p.enrollment_id = $1`, [ID])
console.log('DESPUES:', despues.rows)

await pool.end()
