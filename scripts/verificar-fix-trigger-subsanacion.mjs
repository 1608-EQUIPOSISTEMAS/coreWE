// Verificacion del candado del lead SIN tocar datos: cada intento vive dentro de
// su BEGIN/ROLLBACK. Usa leads reales tal como estan (no cambia el estado de
// ninguna inscripcion), asi que es seguro correrlo contra produccion.
import { pool } from './db.mjs'

const CAMBIO = `UPDATE leads SET observations = coalesce(observations,'') || ' x' WHERE lead_id = $1`

async function intentar (db, leadId) {
  await db.query('BEGIN')
  try {
    await db.query(CAMBIO, [leadId])
    return 'permitido'
  } catch (e) {
    return e.message
  } finally {
    await db.query('ROLLBACK')
  }
}

const db = await pool.connect()
const { rows: [info] } = await db.query('SELECT current_database() AS n, inet_server_port() AS p')
console.log(`BD: ${info.n}:${info.p}`)

const { rows: [observado] } = await db.query(
  `SELECT l.lead_id FROM leads l
     JOIN enrollments e ON e.enrollment_id = l.enrollment_id
     JOIN catalog c ON c.catalog_id = e.cat_fico_status
    WHERE c.alias = 'we_enrollment_status_observed' LIMIT 1`
)
const { rows: [normal] } = await db.query(
  `SELECT l.lead_id FROM leads l
     JOIN enrollments e ON e.enrollment_id = l.enrollment_id
     JOIN catalog c ON c.catalog_id = e.cat_fico_status
    WHERE c.alias <> 'we_enrollment_status_observed' LIMIT 1`
)

console.log(`lead ${observado.lead_id} (venta OBSERVADA)     ->`, await intentar(db, observado.lead_id))
console.log(`lead ${normal.lead_id} (venta normal)         ->`, await intentar(db, normal.lead_id))

db.release()
await pool.end()
