// Prueba del candado del lead: bloquea la edicion tras la venta, pero deja
// subsanar mientras FICO tiene la inscripcion observada.
// Corre contra la BD que apunte .env (por defecto la local de pruebas) y hace
// ROLLBACK de todo: no deja rastro.
import { pool } from './db.mjs'

const SQL_CAMBIO = `UPDATE leads SET observations = coalesce(observations,'') || ' x' WHERE lead_id = $1`

async function intentarEditar (db, { observada }) {
  const { rows: [lead] } = await db.query(
    `SELECT lead_id, enrollment_id FROM leads WHERE enrollment_id IS NOT NULL LIMIT 1`
  )
  await db.query(
    `UPDATE enrollments SET cat_fico_status = $2 WHERE enrollment_id = $1`,
    [
      lead.enrollment_id,
      observada
        ? (await db.query(`SELECT catalog_id FROM catalog WHERE alias='we_enrollment_status_observed'`)).rows[0].catalog_id
        : (await db.query(`SELECT catalog_id FROM catalog WHERE alias='we_enrollment_status_pending'`)).rows[0].catalog_id
    ]
  )
  try {
    await db.query(SQL_CAMBIO, [lead.lead_id])
    return 'permitido'
  } catch (e) {
    return e.message
  }
}

const db = await pool.connect()
for (const observada of [false, true]) {
  await db.query('BEGIN')
  const r = await intentarEditar(db, { observada })
  console.log(observada ? 'OBSERVADA  ->' : 'no observada ->', r)
  await db.query('ROLLBACK')
}
db.release()
await pool.end()
