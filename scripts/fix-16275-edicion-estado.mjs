// One-off 2026-08-12: la 16275 se registró en la edición equivocada (E13-26, 15/10)
// por un error del flujo de alta; debe quedar en E11-26 (inicio 13/08, igual que
// todas sus pares registradas esos días) y volver a revisión FICO.
//
//   node scripts/fix-16275-edicion-estado.mjs --dry
//   node scripts/fix-16275-edicion-estado.mjs
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const ENROLLMENT_ID = 16275
const EDICION_DESTINO = 15509 // E11-26, 2026-08-13
const FICO_PENDIENTE_REVISAR = 3051
const DRY = process.argv.includes('--dry')

const leerEnrollment = () =>
  q(
    `SELECT e.enrollment_id, e.program_edition_id, pe.specific_code AS edicion, pe.start_date,
            e.cat_fico_status, cf.description AS estado_fico,
            e.cat_type_status, e.total_amount, e.modification_date
       FROM enrollments e
       LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
       LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
      WHERE e.enrollment_id = $1`,
    [ENROLLMENT_ID]
  ).then((r) => r.rows[0])

const antes = await leerEnrollment()
if (!antes) throw new Error(`El enrollment ${ENROLLMENT_ID} no existe`)
console.log('ANTES:', antes)

// La edición destino tiene que ser del mismo programa: mover a otro programa es un
// Cambio de Curso, no una corrección de edición.
const { rows: destino } = await q(
  `SELECT pe.edition_num_id, pe.specific_code, pe.start_date, pe.active
     FROM program_editions pe
    WHERE pe.edition_num_id = $1
      AND pe.program_version_id = (SELECT program_version_id FROM program_editions WHERE edition_num_id = $2)`,
  [EDICION_DESTINO, antes.program_edition_id]
)
if (!destino.length) throw new Error(`La edición ${EDICION_DESTINO} no pertenece al programa de ${ENROLLMENT_ID}`)
console.log('DESTINO:', destino[0])

if (DRY) {
  console.log('\n--dry: no se escribió nada.')
  await pool.end()
  process.exit(0)
}

writeFileSync(
  new URL(`./_backup_${ENROLLMENT_ID}_2026-08-12.json`, import.meta.url),
  JSON.stringify(antes, null, 2)
)

const { rowCount } = await q(
  `UPDATE enrollments
      SET program_edition_id = $2,
          cat_fico_status    = $3,
          modification_date  = NOW()
    WHERE enrollment_id = $1`,
  [ENROLLMENT_ID, EDICION_DESTINO, FICO_PENDIENTE_REVISAR]
)
console.log(`UPDATE enrollments: ${rowCount} fila(s)`)

// El panel FICO lee la cabecera de la matview, no de la tabla: sin refresh el
// cambio es invisible en la UI.
await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview mv_enrollment_report_system refrescada')

console.log('DESPUES:', await leerEnrollment())
await pool.end()
