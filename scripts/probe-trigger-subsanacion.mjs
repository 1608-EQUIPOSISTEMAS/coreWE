// ¿El candado del lead ya trae la excepción de subsanación en ESTA BD?
// Solo lee: imprime la definición vigente del trigger y el estado FICO del
// enrollment que se le pase (por defecto el del reporte del 09/09/26).
import { q, pool } from './db.mjs'

const enrollmentId = Number(process.argv[2] || 18729)

const { rows: [donde] } = await q('SELECT current_database() AS bd, inet_server_port() AS puerto')
console.log(`BD: ${donde.bd}:${donde.puerto}`)

const { rows: [fn] } = await q(
  `SELECT pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'trg_block_update_if_enrolled'`
)
const def = fn?.def ?? ''
console.log(`trigger tiene excepción de subsanación: ${def.includes('we_enrollment_status_observed') ? 'SÍ' : 'NO'}`)

const { rows: [alias] } = await q(
  `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_observed'`
)
console.log(`alias we_enrollment_status_observed: ${alias ? `catalog_id ${alias.catalog_id}` : 'NO EXISTE'}`)

const { rows: [e] } = await q(
  `SELECT e.enrollment_id, e.cat_fico_status, c.alias, l.lead_id
     FROM enrollments e
     LEFT JOIN catalog c ON c.catalog_id = e.cat_fico_status
     LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    WHERE e.enrollment_id = $1`,
  [enrollmentId]
)
console.log(`enrollment ${enrollmentId}:`, e ?? 'no existe en esta BD')


// Simulacro del reenvio: el UPDATE real que hace el SP, dentro de un ROLLBACK.
if (e?.lead_id) {
  const db = await pool.connect()
  await db.query('BEGIN')
  try {
    await db.query(`UPDATE leads SET observations = coalesce(observations,'') || ' x' WHERE lead_id = $1`, [e.lead_id])
    console.log(`UPDATE al lead ${e.lead_id}: permitido`)
  } catch (err) {
    console.log(`UPDATE al lead ${e.lead_id}: RECHAZADO -> ${err.message}`)
  }
  await db.query('ROLLBACK')
  db.release()
}
await pool.end()
