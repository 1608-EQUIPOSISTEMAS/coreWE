// Sondeo del modulo Reprogramaciones tras agregar el reembolso (dest_kind RF) y
// las cuotas pendientes en la bandeja. Solo lee y prueba el CHECK; no deja datos.
import { pool } from './db.mjs'
import { ReprogramacionRepository } from '../src/modules/reprogramacion/reprogramacion.repository.js'

const repo = new ReprogramacionRepository(pool)
const filas = await repo.listAffected()
console.log('afectados:', filas.length)
console.log(filas.slice(0, 3).map(f => ({
  venta: f.enrollment_id, alumno: f.apellidos, cuotas: f.cuotas_pendientes
})))

// El CHECK viejo (RP/CC) rechazaba 'RF' y el reembolso reventaba recien al guardar.
const cx = await pool.connect()
try {
  await cx.query('BEGIN')
  const { rows: [venta] } = await cx.query(
    "SELECT enrollment_id FROM enrollments WHERE active = 'Y' LIMIT 1")
  await cx.query(
    "INSERT INTO reprogram_cases (enrollment_id, status, dest_kind) VALUES ($1, 'propuesto', 'RF')",
    [venta.enrollment_id])
  console.log('CHECK acepta RF: OK')
} finally {
  await cx.query('ROLLBACK')
  cx.release()
}
await pool.end()
