// Sondeo del estado 'J' (justificado) del Seguimiento B2B contra la BD LOCAL
// de pruebas: crea la columna notes si falta, marca una sesion justificada de
// un alumno real, la lee de vuelta y deshace el cambio.
//
//   node scripts/probe-b2b-justificacion.mjs
import 'dotenv/config'
import { editionRepository as repo } from '../src/modules/edition/edition.repository.js'
import { pool } from '../src/shared/db/pool.js'

const [alumno] = await repo.b2bTrackingList()
if (!alumno) {
  console.log('No hay alumnos B2B en esta BD; solo se verifica la columna.')
} else {
  const { enrollment_id, edition_num_id } = alumno
  const antes = alumno.attendance?.['1'] || null

  const guardado = await repo.b2bAttendanceSave(
    { enrollment_id, program_edition_id: edition_num_id, session_number: 1, status: 'J', note: 'Sondeo: viaje de trabajo' },
    null
  )
  console.log('guardado ->', guardado.sessions['1'], '|', guardado.notes['1'])

  // Un estado que no es 'J' tiene que llevarse el motivo con el.
  const limpiado = await repo.b2bAttendanceSave(
    { enrollment_id, program_edition_id: edition_num_id, session_number: 1, status: antes, note: null },
    null
  )
  console.log('restaurado ->', limpiado.sessions['1'] ?? '(sin marcar)', '| notes:', JSON.stringify(limpiado.notes))
}

const { rows } = await pool.query(`
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'b2b_attendance' ORDER BY ordinal_position`)
console.table(rows)
await pool.end()
