// Diagnóstico one-off: enrollment 8519 (membresía WE-MB-04, CLAUDIO VILCHES) vs hoja FICO.
import { q, pool } from './db.mjs'

const { rows: e } = await q(`
  SELECT e.*, p.program_name, pm.program_name AS membresia
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs p ON p.program_id = pv.program_id
    LEFT JOIN programs pm ON pm.program_id = e.membership_program_id
   WHERE e.enrollment_id = 8519`)
console.log('--- enrollment 8519 ---')
console.log(JSON.stringify(e[0], null, 1))

const { rows: cli } = await q(`
  SELECT c.customer_id, pe.name, pe.last_name, pe.document_number, pe.email, pe.phone
    FROM enrollments e JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons pe ON pe.person_id = c.person_id WHERE e.enrollment_id = 8519`).catch(err => {
  console.log('customers/persons:', err.message); return { rows: [] }
})
console.log('--- cliente ---'); console.table(cli)

const { rows: cuo } = await q(`
  SELECT i.installment_id, i.installment_number, i.amount, i.due_date::date, i.cat_status,
         c.description AS estado, i.notes
    FROM payment_installments i LEFT JOIN catalog c ON c.catalog_id = i.cat_status
   WHERE i.enrollment_id = 8519 ORDER BY i.installment_number`)
console.log(`--- cuotas (${cuo.length}) ---`); console.table(cuo)

const { rows: pag } = await q(`
  SELECT p.payment_id, p.installment_id, p.amount, p.payment_date::date, p.transaction_code,
         cm.description AS metodo, p.settled_in_account_id, p.cat_payment_type, p.active
    FROM payments p LEFT JOIN catalog cm ON cm.catalog_id = p.cat_method_payment
   WHERE p.enrollment_id = 8519 ORDER BY p.payment_date, p.payment_id`)
console.log(`--- pagos (${pag.length}) ---`); console.table(pag)

const { rows: d } = await q('SELECT * FROM enrollment_discounts WHERE enrollment_id = 8519')
console.log('--- descuentos ---'); console.table(d)

const { rows: l } = await q(
  'SELECT lead_id, full_name, origin_email, pay_date::date, membership_moment_id, cat_client_moment FROM leads WHERE enrollment_id = 8519')
console.log('--- lead ---'); console.table(l)

const { rows: mv } = await q(
  'SELECT * FROM mv_enrollment_report_system WHERE enrollment_id = 8519').catch(() => ({ rows: [] }))
console.log('--- matview ---'); console.log(JSON.stringify(mv[0], null, 1))
await pool.end()
