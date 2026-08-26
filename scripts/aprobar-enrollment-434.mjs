// Corrige la venta #434 (JESLY PEREZ CEPEDA, ESP. VBA MACROS E4-26): quedo en
// FICO "Observado" desde marzo pese a estar pagada al 100% (S/336 el 18/03) y
// con sus dos cursos ya dictados. Autorizado por el usuario el 25/08/2026.
//
// Efecto en el cronograma: su asiento en MICROSOFT EXCEL AVANZADO E5-26 pasa a
// tener su venta contada en la fila de ESP. VBA MACROS E4-26 (+1 VEN).
//
// Idempotente: si ya esta aprobada no hace nada. Una sola conexion (el tunel de
// produccion se cae seguido).
import { q, pool } from './db.mjs'

const ENROLLMENT = 434
const APROBADO = 3052   // catalog we_enrollment_status_checked ("Aprobado")
const OBSERVADO = 3246  // catalog we_enrollment_status_observed
const EDICION_VENTA = 15382 // ESP. EN VBA MACROS EN MICROSOFT EXCEL E4-26
const ADMIN = 9

const { rows: [antes] } = await q(
  'SELECT cat_fico_status FROM enrollments WHERE enrollment_id = $1', [ENROLLMENT])
if (!antes) throw new Error(`no existe el enrollment ${ENROLLMENT}`)
console.log('estado FICO antes:', antes.cat_fico_status)

if (antes.cat_fico_status === APROBADO) {
  console.log('ya estaba aprobada, no se toca nada')
} else if (antes.cat_fico_status !== OBSERVADO) {
  // Guarda: si alguien ya la movio a otro estado, no lo piso a ciegas.
  throw new Error(`estado inesperado ${antes.cat_fico_status}: revisar antes de tocar`)
} else {
  const { rowCount } = await q(
    `UPDATE enrollments SET cat_fico_status = $1, user_modification_id = $2, modification_date = NOW()
      WHERE enrollment_id = $3 AND cat_fico_status = $4`, [APROBADO, ADMIN, ENROLLMENT, OBSERVADO])
  console.log('filas actualizadas:', rowCount)

  await q(`INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, performed_at, justificacion, details)
           VALUES ($1, 'fico_status_fix', $2, NOW(), $3, $4::jsonb)`,
  [ENROLLMENT, ADMIN,
    'Venta pagada al 100% (S/336 el 18/03) y cursada, quedo Observada desde la importacion masiva. Aprobada tras verificar que sus dos hijos (8787, 8788) ya contaban en sus aulas sin venta detras.',
    JSON.stringify({ cat_fico_status: { de: OBSERVADO, a: APROBADO } })])
}

// El panel FICO lee de la matview, no de la tabla: sin refresh el cambio no se ve.
await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')

const { rows: [despues] } = await q(
  `SELECT cf.description AS estado FROM enrollments e
     JOIN catalog cf ON cf.catalog_id = e.cat_fico_status WHERE e.enrollment_id = $1`, [ENROLLMENT])
console.log('estado FICO ahora:', despues.estado)

const { EditionRepository } = await import('../src/modules/edition/edition.repository.js')
const repo = new EditionRepository({ query: (t, p) => q(t, p) })
console.log('cronograma:', await repo.classroomChannelMetricsList([EDICION_VENTA, 14953]))
await pool.end()
