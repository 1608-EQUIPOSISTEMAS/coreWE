// One-off (2026-08-10): el enrollment 16017 se registro con la edicion equivocada.
// Correcta = la que arranca el 08/08/2026 (edition_num_id 15508, E7); tenia 14834 (E4, 21/02).
// Correccion de dato, NO una reprogramacion: no hay cambio de acuerdo con el alumno,
// por eso se pisa la edicion en vez de crear el flujo RP.
//
//   node scripts/fix-16017-edicion.mjs --dry   # solo muestra
//   node scripts/fix-16017-edicion.mjs         # aplica
import { q, pool } from './db.mjs'

const ID = 16017
const EDICION_MALA = 14834
const EDICION_BUENA = 15508
const DRY = process.argv.includes('--dry')

const mostrar = async (titulo, sql, params) => {
  const { rows } = await q(sql, params)
  console.log(`\n${titulo}:`)
  rows.length ? console.table(rows) : console.log('  (sin filas)')
  return rows
}

await mostrar(
  'enrollment',
  `SELECT e.enrollment_id, e.program_edition_id, pe.global_code, pe.start_date
     FROM enrollments e JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.enrollment_id = $1`,
  [ID]
)
await mostrar(
  'lead vinculado',
  `SELECT lead_id, program_edition_id, registration_date, pay_date FROM leads WHERE enrollment_id = $1`,
  [ID]
)
await mostrar(
  'rastros en aula (notas / asistencia b2b)',
  `SELECT (SELECT count(*) FROM classroom_student_grades WHERE enrollment_id = $1) AS notas,
          (SELECT count(*) FROM b2b_attendance WHERE enrollment_id = $1) AS asistencias`,
  [ID]
)

if (DRY) {
  console.log(`\n[dry] no se aplico nada. Cambio propuesto: ${EDICION_MALA} -> ${EDICION_BUENA}`)
  await pool.end()
  process.exit(0)
}

const { rows: [actualizado] } = await q(
  `UPDATE enrollments
      SET program_edition_id = $1, modification_date = NOW()
    WHERE enrollment_id = $2 AND program_edition_id = $3
    RETURNING enrollment_id, program_edition_id`,
  [EDICION_BUENA, ID, EDICION_MALA]
)
console.log('\nactualizado:', actualizado ?? 'nada (¿ya estaba corregido?)')

// El panel FICO lee de la matview, no de la tabla: sin refresh el cambio no se ve.
await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')

await mostrar(
  'estado final',
  `SELECT e.enrollment_id, e.program_edition_id, pe.global_code, pe.start_date, pe.end_date
     FROM enrollments e JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.enrollment_id = $1`,
  [ID]
)

await pool.end()
