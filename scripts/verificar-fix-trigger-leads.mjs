// Verificacion de solo lectura del candado trg_block_update_if_enrolled: confirma
// que el desenganche del lead (enrollment_id = NULL, lo que necesita el borrado
// de una venta) pasa y que el resto del lead vendido sigue congelado. Los UPDATE
// van dentro de transacciones que siempre terminan en ROLLBACK.
import { pool } from './db.mjs'
const client = await pool.connect()
const d = (await client.query('SELECT current_database() db, inet_server_port() port')).rows[0]
console.log(`BD: ${d.db}:${d.port}`)
const src = (await client.query("SELECT pg_get_functiondef(oid) src FROM pg_proc WHERE proname='trg_block_update_if_enrolled'")).rows[0].src
console.log('guarda NEW.enrollment_id IS NULL presente:', /NEW\.enrollment_id IS NULL/.test(src) ? 'SI' : 'NO')

const { enrollment_id: ID, lead_id: LEAD } = (await client.query(
  'SELECT enrollment_id, lead_id FROM leads WHERE enrollment_id IS NOT NULL ORDER BY lead_id DESC LIMIT 1')).rows[0]
console.log(`cobaya: enrollment ${ID} <- lead ${LEAD}`)

const pasa = async (sql, params) => {
  await client.query('BEGIN')
  try { await client.query(sql, params); return true }
  catch (e) { if (!/ya tiene enrollment_id/.test(e.message)) throw e; return false }
  finally { await client.query('ROLLBACK') }
}
console.log('desenganchar el lead (enrollment_id = NULL):', await pasa(
  `UPDATE leads SET enrollment_id=NULL, cat_status_lead=COALESCE((SELECT catalog_id FROM catalog WHERE alias='we_lead_status_atendido' LIMIT 1), cat_status_lead) WHERE enrollment_id=$1`, [ID]) ? 'PASA' : 'BLOQUEA')
console.log('tocar otro campo del lead vendido:       ', await pasa(
  "UPDATE leads SET observations = COALESCE(observations,'') || 'X' WHERE lead_id=$1", [LEAD]) ? 'PASA' : 'BLOQUEA (sigue congelado)')
client.release(); await pool.end()
