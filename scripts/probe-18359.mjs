// Sondeo del enrollment 18359: cuotas, pagos y bitacora, para revertir la cuota
// que FICO confirmo de prueba y ver por que no salio el correo.
import fs from 'node:fs'
import pg from 'pg'

const url = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim().replace(/^#\s*/, ''))
  .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432'))
  ?.slice('DATABASE_URL='.length)
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000 })
const q = (t, p) => pool.query(t, p)
const ID = Number(process.argv[2] || 18359)

const { rows: e } = await q(`
  SELECT e.enrollment_id, e.customer_id, e.program_edition_id, e.parent_enrollment_id,
         e.cat_type_status, cs.description AS estado, e.cat_fico_status, cf.description AS fico,
         e.total_amount, e.discount_amount, e.active, e.flag_send, e.requires_email_cc,
         e.email_cc, e.odoo_order_id, e.odoo_student_id, e.registration_date, e.notes
    FROM enrollments e
    LEFT JOIN catalog cs ON cs.catalog_id = e.cat_type_status
    LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
   WHERE e.enrollment_id = $1`, [ID])
console.log('== ENROLLMENT =='); console.dir(e[0], { depth: null })

const { rows: cu } = await q(`
  SELECT i.installment_id, i.installment_number, i.amount, i.due_date, i.cat_status,
         c.alias, c.description AS estado, i.notes
    FROM payment_installments i LEFT JOIN catalog c ON c.catalog_id = i.cat_status
   WHERE i.enrollment_id = $1 ORDER BY i.installment_number`, [ID])
console.log('== CUOTAS =='); console.table(cu)

const { rows: pgs } = await q(`
  SELECT p.payment_id, p.installment_id, p.amount, p.payment_date, p.active,
         p.cat_payment_type, c.description AS tipo, p.transaction_code, p.registration_date
    FROM payments p LEFT JOIN catalog c ON c.catalog_id = p.cat_payment_type
   WHERE p.enrollment_id = $1 ORDER BY p.payment_id`, [ID])
console.log('== PAGOS =='); console.table(pgs)

const { rows: au } = await q(`
  SELECT audit_id, action, performed_by, justificacion, details, performed_at
    FROM enrollment_audit_log WHERE enrollment_id = $1 ORDER BY audit_id DESC LIMIT 15`, [ID])
console.log('== AUDITORIA =='); console.table(au)

await pool.end()
