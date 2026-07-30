import 'dotenv/config'
import pg from 'pg'
const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const pw = process.env.PGPASSWORD || decodeURIComponent(m[2])
const c = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: pw, connectionTimeoutMillis: 10000 })
await c.connect()
const show = async (label, sql, params = []) => {
  try { const r = await c.query(sql, params); console.log('\n=== ' + label + ' (' + r.rowCount + ') ==='); console.table(r.rows) } catch (e) { console.log('\n=== ' + label + ' ERROR: ' + e.message) }
}
await show('MV columnas', "select column_name from information_schema.columns where table_name='mv_enrollment_report_system' order by ordinal_position")
await show('CABECERA', 'select enrollment_id, total_amount, list_price, discount_amount, cat_type_status, cat_payment_plan, cat_currency, cat_fico_status, cat_profile_id, program_edition_id from enrollments where enrollment_id=10598')
await show('CUOTAS', 'select installment_number, amount, due_date::date, cat_status from payment_installments where enrollment_id=10598 order by installment_number, installment_id')
await show('PAGOS', 'select payment_id, installment_id, amount, payment_date::date, cat_method_payment, cat_payment_type, settled_in_account_id, transaction_code from payments where enrollment_id=10598 order by payment_date, payment_id')
await show('DESCUENTOS', 'select discount_id, order_applied, calculated_amount from enrollment_discounts where enrollment_id=10598 order by order_applied')
await show('HIJOS', 'select enrollment_id, program_edition_id, cat_type_status, cat_payment_plan, total_amount from enrollments where parent_enrollment_id=10598 order by enrollment_id')
await show('AUDIT', "select audit_id, action, performed_by, performed_at::date, left(justificacion,90) just from enrollment_audit_log where enrollment_id=10598")
await c.end()
