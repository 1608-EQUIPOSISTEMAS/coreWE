// Reproduce, dentro de un ROLLBACK, la secuencia real de sp_comercial_enrollment_register
// en su rama de subsanacion: primero devuelve la inscripcion a Pendiente y DESPUES
// actualiza el lead. Sirve para ver si el candado del lead sigue disparando.
import { pool } from './db.mjs'

const leadId = Number(process.argv[2] || 430165)
const db = await pool.connect()

const { rows: [{ bd }] } = await db.query('SELECT current_database() AS bd')
console.log(`BD: ${bd}`)

const { rows: [ids] } = await db.query(
  `SELECT (SELECT catalog_id FROM catalog WHERE alias='we_enrollment_status_pending') AS pendiente,
          (SELECT enrollment_id FROM leads WHERE lead_id=$1) AS enrollment_id`, [leadId])
console.log(ids)

async function correr (devolverAPendiente) {
  await db.query('BEGIN')
  try {
    if (devolverAPendiente) {
      await db.query('UPDATE enrollments SET cat_fico_status=$1 WHERE enrollment_id=$2',
        [ids.pendiente, ids.enrollment_id])
    }
    await db.query(
      `UPDATE leads SET origin_email='prueba@we.pe', modification_date=NOW() WHERE lead_id=$1`, [leadId])
    return 'permitido'
  } catch (e) {
    return `RECHAZADO -> ${e.message}`
  } finally {
    await db.query('ROLLBACK')
  }
}

console.log('UPDATE al lead con la inscripcion aun OBSERVADA   ->', await correr(false))
console.log('UPDATE al lead tras devolverla a PENDIENTE (SP)   ->', await correr(true))

db.release()
await pool.end()
