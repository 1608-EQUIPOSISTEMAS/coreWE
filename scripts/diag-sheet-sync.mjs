// One-off: por que un enrollment no sube al Sheet FICO.
// Uso: node scripts/diag-sheet-sync.mjs 18346
//
// Lee la URL de PRODUCCION de la linea comentada del .env (el tunel 55432) para
// no tener que exportar PGPASSWORD, que partiria los pools en dos BD distintas.
import fs from 'node:fs'
import pg from 'pg'

const URL_PRODUCCION = fs.readFileSync('.env', 'utf8')
  .split('\n')
  .map((linea) => linea.match(/postgresql:\/\/[^\s'"]*55432\/neondb/)?.[0])
  .find(Boolean)

const pool = new pg.Pool({ connectionString: URL_PRODUCCION, max: 2, connectionTimeoutMillis: 15000 })
const id = Number(process.argv[2])

const { rows } = await pool.query(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.active, e.registration_date, e.total_amount,
         e.notes, e.program_version_id, e.program_edition_id, e.membership_program_id,
         e.cat_b2b_doctype, e.cat_event_category, e.flag_send,
         cf.alias AS fico_alias, cf.description AS fico_desc,
         cs.alias AS status_alias, cs.description AS status_desc,

         (SELECT lf.pay_date FROM leads lf WHERE lf.enrollment_id = e.enrollment_id LIMIT 1) AS lead_pay_date,
         (SELECT MIN(py.payment_date::date) FROM payments py
           WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS primer_pago,
         (SELECT COUNT(*) FROM payments py
           WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS pagos,
         (SELECT COUNT(*) FROM enrollments c WHERE c.parent_enrollment_id = e.enrollment_id) AS hijos,
         (SELECT COUNT(*) FROM course_changes cc
           WHERE cc.enrollment_destination_id = e.enrollment_id AND cc.active = 'Y') AS es_destino_cc
    FROM enrollments e
    LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN catalog cs ON cs.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = $1`, [id])

console.log('ENROLLMENT:', JSON.stringify(rows[0], null, 2))

if (rows[0]?.parent_enrollment_id) {
  const padre = await pool.query(`
    SELECT e.enrollment_id, e.notes, e.registration_date, e.total_amount, e.active,
           cf.alias AS fico_alias,
           (SELECT lf.pay_date FROM leads lf WHERE lf.enrollment_id = e.enrollment_id LIMIT 1) AS lead_pay_date,
           (SELECT MIN(py.payment_date::date) FROM payments py
             WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS primer_pago
      FROM enrollments e
      LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
     WHERE e.enrollment_id = $1`, [rows[0].parent_enrollment_id])
  console.log('PADRE:', JSON.stringify(padre.rows[0], null, 2))
}

await pool.end()
