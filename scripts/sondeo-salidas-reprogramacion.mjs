// Verifica que los 4 dest_kind del modulo Reprogramaciones entren en la BD
// (RP/CC reubican, RF reembolso, RV reserva de vacante). Rollback: no deja datos.
import { pool } from './db.mjs'

const cx = await pool.connect()
try {
  const { rows: [venta] } = await cx.query(
    "SELECT enrollment_id FROM enrollments WHERE active = 'Y' LIMIT 1")
  for (const kind of ['RP', 'CC', 'RF', 'RV']) {
    await cx.query('BEGIN')
    await cx.query(
      "INSERT INTO reprogram_cases (enrollment_id, status, dest_kind) VALUES ($1, 'propuesto', $2)",
      [venta.enrollment_id, kind])
    await cx.query('ROLLBACK')
    console.log(`${kind}: OK`)
  }
} finally {
  cx.release()
}
await pool.end()
