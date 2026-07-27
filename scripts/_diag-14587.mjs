// Diagnóstico one-off: enrollment 14587 sin fecha de inicio (edición no asignada).
import { q, pool } from './db.mjs'

const { rows: enr } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.program_edition_id, e.program_version_id,
         e.total_amount, e.cat_fico_status, e.active, e.customer_id, e.flag_send,
         e.registration_date::date, e.cat_inscription_modality,
         pv.program_id, p.program_name, pe.specific_code, pe.start_date::date AS inicio
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs p ON p.program_id = pv.program_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
   WHERE e.enrollment_id = 14587 OR e.parent_enrollment_id = 14587
   ORDER BY e.parent_enrollment_id NULLS FIRST, e.enrollment_id`)
console.log('--- 14587 y familia ---')
console.table(enr)

const padre = enr.find(r => r.enrollment_id === 14587)
const { rows: lead } = await q(
  `SELECT lead_id, full_name, origin_email, program_edition_id, program_version_id,
          cat_program_modality, pay_date::date, cat_status_lead
     FROM leads WHERE enrollment_id = 14587`)
console.log('--- lead ---'); console.table(lead)

const { rows: tok } = await q(
  `SELECT token_id, amount, status, payment_type, lead_id, created_at,
          inscription_data->>'program_edition_id' AS insc_ed,
          inscription_data->>'modality' AS insc_mod
     FROM payment_tokens WHERE enrollment_id = 14587`)
console.log('--- tokens ---'); console.table(tok)

const { rows: aud } = await q(
  `SELECT audit_id, action, performed_by, performed_at, token_id, left(details,110) AS details
     FROM enrollment_audit_log WHERE enrollment_id = 14587 ORDER BY audit_id`)
console.log('--- audit ---'); console.table(aud)

const progId = padre?.program_id || lead[0]?.program_version_id
if (padre?.program_id) {
  const { rows: eds } = await q(`
    SELECT pe.edition_num_id, pe.specific_code, pe.start_date::date AS inicio,
           pe.end_date::date AS fin, pe.active, pe.cat_segment
      FROM program_editions pe
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
     WHERE pv.program_id = $1 AND pe.start_date::date BETWEEN '2026-07-01' AND '2026-10-31'
     ORDER BY pe.start_date`, [padre.program_id])
  console.log(`--- ediciones del programa ${progId} ---`); console.table(eds)
}
await pool.end()
