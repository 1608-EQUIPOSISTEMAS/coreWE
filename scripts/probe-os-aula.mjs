// Cuantas ventas OS/OP aprobadas por FICO y aun sin cobrar quedaban fuera de
// "1. Aula Sistemas" por el filtro de cobranza. Sondeo, no modifica nada.
import { q, pool } from './db.mjs'

const SQL = `
SELECT e.enrollment_id, pv.version_code, pe.global_code,
       TRIM(concat_ws(' ', p.first_name, p.last_name)) AS alumno,
       e.total_amount, c_doc.alias AS doctype
  FROM enrollments e
  JOIN catalog cf   ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
  JOIN catalog c_doc ON c_doc.catalog_id = COALESCE(
         (SELECT os.cat_b2b_doctype FROM enrollments os
           WHERE os.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)))
  JOIN customers cu ON cu.customer_id = e.customer_id
  JOIN persons p    ON p.person_id = cu.person_id
  LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
 WHERE e.active = 'Y'
   AND c_doc.alias IN ('we_enrollment_b2b_doctype_service_order', 'we_enrollment_b2b_doctype_purchase_order')
   AND NOT EXISTS (SELECT 1 FROM enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
   AND NOT EXISTS (
         SELECT 1 FROM payments py
          WHERE py.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id) AND py.active = 'Y')
   AND (SELECT os.total_amount FROM enrollments os
         WHERE os.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)) > 0
 ORDER BY e.enrollment_id`

const { rows } = await q(SQL)
console.table(rows)
console.log('total:', rows.length)
await pool.end()
