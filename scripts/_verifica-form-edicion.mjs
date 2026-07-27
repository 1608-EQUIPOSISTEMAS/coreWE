// ¿El formulario FICO trae bien la edición? Dos comprobaciones:
//  1. sp_edition_caller devuelve las ediciones + start_date/start_date_label del curso.
//  2. cuántos enrollments quedaron con program_edition_id NULL sin ser membresía.
import { pool, q } from './db.mjs'
import { callProcedureReturningRows } from '../src/utils/spHelper.js'

const eds = await callProcedureReturningRows(pool, 'public.sp_edition_caller', [1, null, null, null, null, null])
console.log('--- sp_edition_caller(program_version_id=1) — SAP S/4 HANA MM ---')
console.table(eds.map(e => ({
  id: e.edition_num_id, code: e.global_code || e.edition_code,
  start_date: e.start_date, start_date_label: e.start_date_label, active: e.active
})))

const { rows: nulos } = await q(`
  SELECT e.enrollment_id, e.registration_date::date AS registro, p.program_name,
         c.description AS modalidad, e.membership_program_id AS memb, e.parent_enrollment_id AS padre,
         e.total_amount, e.cat_fico_status
    FROM enrollments e
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
    LEFT JOIN catalog c ON c.catalog_id = p.cat_model_modality
   WHERE e.program_edition_id IS NULL
     AND p.is_membership = 'N'
     AND e.registration_date >= '2026-05-01'
   ORDER BY e.registration_date DESC, e.enrollment_id DESC`)
console.log(`--- enrollments SIN edicion (no membresia) desde 01/05: ${nulos.length} ---`)
console.table(nulos)
await pool.end()
