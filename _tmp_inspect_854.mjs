import pg from 'pg'
import { config } from 'dotenv'
config()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
const q = (sql, p) => pool.query(sql, p).then(r => r.rows)

console.log('== ENROLLMENT 854 ==')
console.table(await q(`
  SELECT e.enrollment_id, e.program_edition_id, pe.global_code AS ed, pe.start_date::date AS inicio,
         e.program_version_id, pv.abbreviation, cts.alias AS estado, cf.alias AS fico,
         e.total_amount, e.discount_amount, e.list_price, cpp.alias AS plan,
         e.seller_agent_id, e.agent_origin, e.odoo_user_id, e.odoo_order_id, e.active
  FROM enrollments e
  LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
  LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
  LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
  LEFT JOIN catalog cpp ON cpp.catalog_id = e.cat_payment_plan
  WHERE e.enrollment_id = 854`))

console.log('== AUDIT ==')
for (const a of await q(`
  SELECT performed_at::date AS f, action, performed_by, details, changes
  FROM enrollment_audit_log WHERE enrollment_id = 854 ORDER BY performed_at`)) {
  console.log(String(a.f).slice(0,15), '|', a.action, '| by', a.performed_by, '|', String(a.details).slice(0,120), '|', JSON.stringify(a.changes)?.slice(0, 250))
}

console.log('== CUOTAS ==')
console.table(await q(`
  SELECT pi.installment_id, pi.installment_number AS n, pi.amount, pi.due_date::date AS vence,
         pi.cat_status, c.alias AS estado, pi.notes
  FROM payment_installments pi LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
  WHERE pi.enrollment_id = 854 ORDER BY pi.installment_number`))

console.log('== PAYMENTS ==')
console.table(await q(`
  SELECT payment_id, installment_id, amount, payment_date::date AS fecha, active
  FROM payments WHERE enrollment_id = 854 ORDER BY payment_id`))

console.log('== HIJOS ==')
console.table(await q(`
  SELECT e.enrollment_id, pe.global_code AS ed, pe.start_date::date AS inicio, pv.abbreviation, cts.alias AS estado, e.active
  FROM enrollments e
  LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
  LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
  WHERE e.parent_enrollment_id = 854 ORDER BY pe.start_date`))
await pool.end()
