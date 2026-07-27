// One-off: fija las fechas de inicio de los hijos SEG de 14580.
//   14581 MICROSOFT EXCEL AVANZADO -> edicion que inicia 2026-07-30
//   14582 PROGRAMACION CON VBA MACROS -> edicion que inicia 2026-08-27
// Idempotente: si ya apunta a la edicion correcta, no hace nada.
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const OBJETIVO = [
  { enrollment_id: 14581, program_id: 19, inicio: '2026-07-30' },
  { enrollment_id: 14582, program_id: 20, inicio: '2026-08-27' }
]

const cli = await pool.connect() // ponytail: una sola conexion, el tunel se cae seguido
try {
  const antes = (await cli.query(
    `SELECT enrollment_id, program_edition_id, program_version_id
       FROM enrollments WHERE enrollment_id = ANY($1::int[])`,
    [OBJETIVO.map(o => o.enrollment_id)])).rows
  writeFileSync(new URL('./_backup_14580_ediciones.json', import.meta.url), JSON.stringify(antes, null, 2))
  console.log('backup ->', antes)

  await cli.query('BEGIN')
  for (const o of OBJETIVO) {
    const { rows: eds } = await cli.query(
      `SELECT pe.edition_num_id, pe.program_version_id, pe.specific_code
         FROM program_editions pe
         JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
        WHERE pv.program_id = $1 AND pe.start_date::date = $2::date AND pe.active = 'Y'`,
      [o.program_id, o.inicio])
    if (eds.length !== 1) throw new Error(`prog ${o.program_id} @ ${o.inicio}: ${eds.length} ediciones activas`)
    const ed = eds[0]

    const { rowCount } = await cli.query(
      `UPDATE enrollments
          SET program_edition_id = $1, program_version_id = $2, modification_date = now()
        WHERE enrollment_id = $3 AND program_edition_id IS DISTINCT FROM $1`,
      [ed.edition_num_id, ed.program_version_id, o.enrollment_id])
    console.log(`${o.enrollment_id} -> ed ${ed.edition_num_id} (${ed.specific_code}, ${o.inicio}) : ${rowCount ? 'actualizado' : 'ya estaba'}`)
  }
  await cli.query('COMMIT')

  const { rows } = await cli.query(`
    SELECT e.enrollment_id, e.parent_enrollment_id, pe.specific_code,
           pe.start_date::date AS inicio, pe.end_date::date AS fin, p.program_name
      FROM enrollments e
      JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN programs p ON p.program_id = pv.program_id
     WHERE e.enrollment_id = 14580 OR e.parent_enrollment_id = 14580
     ORDER BY e.enrollment_id`)
  console.table(rows)
} catch (e) {
  await cli.query('ROLLBACK').catch(() => {})
  throw e
} finally {
  cli.release()
}

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
