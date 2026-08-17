// Radiografia del enrollment 13936 (sergio.cristobal.soto@gmail.com) antes de
// corregir el ingreso de S/290.50 a S/291.00 pedido por FICO.
//   node scripts/probe-13936-monto.mjs
import { pool } from './db.mjs'

const ID = 13936

const { rows: cols } = await pool.query(`
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'enrollments' ORDER BY ordinal_position`)
console.log('== columnas enrollments =='); console.log(cols.map(c => c.column_name).join(', '))

const { rows: cab } = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = $1', [ID])
console.log('== enrollment =='); console.log(cab[0])

const { rows: pagos } = await pool.query(`
  SELECT p.payment_id, p.installment_id, p.amount, p.payment_date, p.active,
         ct.alias AS tipo, cm.description AS metodo
    FROM payments p
    LEFT JOIN catalog ct ON ct.catalog_id = p.cat_payment_type
    LEFT JOIN catalog cm ON cm.catalog_id = p.cat_method_payment
   WHERE p.enrollment_id = $1 ORDER BY p.payment_id`, [ID])
console.log('== payments =='); console.table(pagos)

const { rows: cuotas } = await pool.query(`
  SELECT i.installment_id, i.installment_number, i.amount, i.due_date, c.description AS estado
    FROM payment_installments i LEFT JOIN catalog c ON c.catalog_id = i.cat_status
   WHERE i.enrollment_id = $1 ORDER BY i.installment_number`, [ID])
console.log('== cuotas =='); console.table(cuotas)

const { rows: audit } = await pool.query(`
  SELECT audit_id, action, performed_at, justificacion, details
    FROM enrollment_audit_log WHERE enrollment_id = $1 ORDER BY performed_at DESC LIMIT 15`, [ID])
console.log('== auditoria =='); console.table(audit)

await pool.end()
