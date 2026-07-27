// One-off: 14587 (SAP S/4 HANA MM) se registro sin edicion -> program_edition_id NULL.
// Le asigna la edicion que inicia 2026-07-30. Idempotente.
import { q, pool } from './db.mjs'

const ENR = 14587
const INICIO = '2026-07-30'

const { rows: eds } = await q(`
  SELECT pe.edition_num_id, pe.program_version_id, pe.specific_code
    FROM program_editions pe
    JOIN enrollments e ON e.program_version_id = pe.program_version_id
   WHERE e.enrollment_id = $1 AND pe.start_date::date = $2::date AND pe.active = 'Y'`, [ENR, INICIO])
if (eds.length !== 1) throw new Error(`${eds.length} ediciones activas @ ${INICIO}`)
const ed = eds[0]

const { rowCount } = await q(
  `UPDATE enrollments SET program_edition_id = $1, modification_date = now()
    WHERE enrollment_id = $2 AND program_edition_id IS DISTINCT FROM $1`, [ed.edition_num_id, ENR])
console.log(`${ENR} -> ed ${ed.edition_num_id} (${ed.specific_code}, ${INICIO}): ${rowCount ? 'actualizado' : 'ya estaba'}`)

const { rows } = await q(`
  SELECT e.enrollment_id, pe.specific_code, pe.start_date::date AS inicio, pe.end_date::date AS fin, p.program_name
    FROM enrollments e
    JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
   WHERE e.enrollment_id = $1`, [ENR])
console.table(rows)

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
