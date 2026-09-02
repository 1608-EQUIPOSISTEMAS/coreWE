// La bandeja tiene que seguir mostrando una venta despues del veredicto, aunque
// el alumno ya no este "vivo" (reprogramado / cambiado / retirado). Sin eso el
// estado que ve Academica desaparece justo cuando FICO lo aprueba.
// Simula un caso RV aceptado + retiro y revierte todo al final.
import { pool } from './db.mjs'
import { ReprogramacionRepository } from '../src/modules/reprogramacion/reprogramacion.repository.js'

const cx = await pool.connect()
const repo = new ReprogramacionRepository(cx)
try {
  await cx.query('BEGIN')
  const antes = await repo.listAffected()
  const victima = antes[0]
  console.log('bandeja inicial:', antes.length, '- pruebo con la venta', victima.enrollment_id)

  await cx.query(
    "INSERT INTO reprogram_cases (enrollment_id, status, dest_kind) VALUES ($1, 'aceptado', 'RV')",
    [victima.enrollment_id])
  // Retirarlo es lo que hace el veredicto de una reserva de vacante.
  await cx.query(`
    UPDATE enrollments SET cat_type_status =
      (SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_retired')
     WHERE enrollment_id = $1`, [victima.enrollment_id])

  const despues = await repo.listAffected()
  const fila = despues.find(f => f.enrollment_id === victima.enrollment_id)
  console.log('sigue en la bandeja:', !!fila, '| estado:', fila?.status, '| kind:', fila?.dest_kind)
  console.log('caidas visibles:', fila?.caidas?.length ?? 0)
} finally {
  await cx.query('ROLLBACK')
  cx.release()
}
await pool.end()
