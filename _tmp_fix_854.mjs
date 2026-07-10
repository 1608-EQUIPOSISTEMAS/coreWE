// Fix puntual enrollment 854: RP del 09/07 con flujo viejo (fila movida a E36,
// cuota contado corrida +63d). Todo pagado -> destino sin cuotas trasladadas.
import 'dotenv/config'
import './src/modules/fico/fico.bootstrap.js'
import { pool } from './src/shared/db/pool.js'
import { logAudit } from './src/modules/fico/audit/audit.usecases.js'
import { reprogramEdition } from './src/modules/fico/enrollment/enrollment.usecases.js'

const EID = 854
const OLD_ED = 15398 // E34 28/05/2026
const NEW_ED = 15429 // E36 30/07/2026
const SHIFTED = [1130] // cuota contado corrida +63d por el flujo viejo
const USER = 22

const { rows: [cur] } = await pool.query(
  `SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1`, [EID])
if (!cur || cur.program_edition_id !== NEW_ED) {
  console.error('ABORT: 854 no esta en E36:', cur); process.exit(1)
}
const { rows: [orig] } = await pool.query(
  `SELECT justificacion FROM enrollment_audit_log
   WHERE enrollment_id = $1 AND action = 'edition_reprogrammed' ORDER BY performed_at DESC LIMIT 1`, [EID])

const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(`UPDATE enrollments SET program_edition_id = $1 WHERE enrollment_id = $2`, [OLD_ED, EID])
  const r = await client.query(
    `UPDATE payment_installments SET due_date = due_date - INTERVAL '63 days'
     WHERE installment_id = ANY($1) AND enrollment_id = $2 RETURNING installment_id, due_date::date`,
    [SHIFTED, EID])
  if (r.rowCount !== SHIFTED.length) throw new Error(`Esperaba ${SHIFTED.length}, actualizo ${r.rowCount}`)
  await client.query('COMMIT')
  console.log('Revert OK:', r.rows)
} catch (e) {
  await client.query('ROLLBACK'); console.error('Revert FALLO:', e.message); process.exit(1)
} finally { client.release() }

await logAudit({
  enrollmentId: EID, action: 'edited', userId: USER,
  details: 'Fix modelo RP: revertido a E34 (28/05/2026) y fecha de cuota contado restaurada (-63 dias) para re-ejecutar la reprogramacion con el modelo de 2 inscripciones'
})

const res = await reprogramEdition({
  enrollmentId: EID,
  newEditionId: NEW_ED,
  justificacion: `${orig?.justificacion || 'Reprogramacion solicitada'} (fix: re-aplicado con modelo RP de 2 inscripciones)`,
  userId: USER
})
console.log('reprogramEdition =>', res)

try {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system')
  console.log('Matview refrescada')
} catch (e) { console.error('Matview refresh fallo:', e.message) }
process.exit(0)
