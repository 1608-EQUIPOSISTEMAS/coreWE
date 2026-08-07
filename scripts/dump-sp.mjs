// Vuelca el cuerpo de un stored procedure a stdout, numerado.
//   node scripts/dump-sp.mjs sp_comercial_enrollment_register > /tmp/sp.sql
import { q, pool } from './db.mjs'

const name = process.argv[2]
if (!name) throw new Error('uso: node scripts/dump-sp.mjs <nombre_sp>')

const { rows } = await q(
  `SELECT pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = $1`,
  [name]
)
if (!rows.length) throw new Error(`${name} no existe`)
console.log(rows[0].def)

await pool.end()
