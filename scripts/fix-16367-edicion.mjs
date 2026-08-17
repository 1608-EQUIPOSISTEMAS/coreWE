// One-off REVERTIDO. Historial de lo que paso con la inscripcion 16367:
//
// 1. Se le asigno la edicion E37 / E8-26 (inicio sabado 05/09/2026) creyendo que
//    el program_edition_id NULL era un dato faltante.
// 2. NO lo era: 16367 esta en escenario E0. Tiene un modulo convalidado
//    (DATA ANALYTICS), asi que createChildEnrollments llamo a clearParentEdition
//    y nulea la edicion del padre A PROPOSITO — ver validation.usecases.js.
//    El NULL es el marcador que hace que odoo-sync saltee al padre
//    (isE0Parent); sin el, el alumno entraria al slide_group del diplomado
//    COMPLETO y se llevaria gratis el modulo que convalido.
// 3. Este script deshace el paso 1 y devuelve el padre a NULL.
//
// La edicion real de la venta NO se pierde: vive en leads.program_edition_id
// (15437) y en los 4 enrollments hijos, cada uno con su propia edicion.
import { q, pool } from './db.mjs'

const ENROLLMENT_ID = 16367

const { rows: antes } = await q(
  'SELECT enrollment_id, program_edition_id FROM enrollments WHERE enrollment_id = $1',
  [ENROLLMENT_ID])
console.log('antes:', antes)

const { rows: hijos } = await q(`
  SELECT h.enrollment_id, pv.abbreviation AS modulo, pe.global_code, pe.start_date
    FROM enrollments h
    LEFT JOIN program_versions pv ON pv.program_version_id = h.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = h.program_edition_id
   WHERE h.parent_enrollment_id = $1 AND h.active = 'Y'
   ORDER BY h.enrollment_id`, [ENROLLMENT_ID])
console.log('hijos (aqui vive la edicion real):', hijos)

const { rows: revertido } = await q(`
  UPDATE enrollments
     SET program_edition_id = NULL, modification_date = now()
   WHERE enrollment_id = $1
  RETURNING enrollment_id, program_edition_id`, [ENROLLMENT_ID])
console.log('revertido a E0:', revertido)

await q(`INSERT INTO enrollment_audit_log (enrollment_id, action, performed_at, justificacion, details)
  VALUES ($1, 'enrollment_update', now(),
    'Revert: el program_edition_id NULL es el marcador de E0, no un dato faltante',
    'Revertida la asignacion manual de la edicion E37/E8-26; el padre vuelve a E0')`,
[ENROLLMENT_ID])

await q('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system')
const { rows: mv } = await q(
  'SELECT "COD", "FECHA DE INICIO" FROM public.mv_enrollment_report_system WHERE "ID"::int = $1',
  [ENROLLMENT_ID])
console.log('matview:', mv)

await pool.end()
