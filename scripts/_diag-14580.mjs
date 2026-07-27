// Diagnóstico one-off: enrollment 14580 y sus hijos SEG, para fijar fechas de inicio.
import { q, pool } from './db.mjs'

const FAM = `
  SELECT e.enrollment_id, e.parent_enrollment_id, e.program_edition_id,
         pv.program_id, p.program_name, pe.specific_code, pe.start_date::date AS inicio,
         pe.end_date::date AS fin, e.cat_fico_status, e.active, e.total_amount
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    LEFT JOIN programs p ON p.program_id = pv.program_id
   WHERE e.enrollment_id = 14580 OR e.parent_enrollment_id = 14580
   ORDER BY e.parent_enrollment_id NULLS FIRST, e.enrollment_id`

const { rows: fam } = await q(FAM)
console.log('--- familia 14580 ---')
console.table(fam)

const progIds = [...new Set(fam.filter(r => r.parent_enrollment_id).map(r => r.program_id))].filter(Boolean)
if (progIds.length) {
  const { rows: eds } = await q(`
    SELECT pe.edition_num_id, pv.program_id, p.program_name, pe.specific_code,
           pe.start_date::date AS inicio, pe.end_date::date AS fin, pe.active, pe.cat_status_edition
      FROM program_editions pe
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN programs p ON p.program_id = pv.program_id
     WHERE pv.program_id = ANY($1::int[])
       AND pe.start_date::date BETWEEN '2026-07-01' AND '2026-10-31'
     ORDER BY pv.program_id, pe.start_date`, [progIds])
  console.log('--- ediciones candidatas (jul-oct) ---')
  console.table(eds)
}
await pool.end()
