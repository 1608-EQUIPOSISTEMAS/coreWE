// Vuelca el cuerpo vivo de un SP/funcion de la BD. Los SPs no estan versionados
// en el repo, asi que este es el unico modo de leer lo que corre de verdad.
//
//   node scripts/dump-sp.mjs sp_comercial_lead_register
import { q, pool } from './db.mjs'

const nombre = process.argv[2]
if (!nombre) { console.error('uso: node scripts/dump-sp.mjs <nombre_del_sp>'); process.exit(1) }

const { rows } = await q(`
  SELECT p.oid::regprocedure AS firma, pg_get_functiondef(p.oid) AS cuerpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f','p') AND p.proname = $1`, [nombre])

if (rows.length === 0) console.error(`no existe public.${nombre}`)
for (const r of rows) console.log(`\n===== ${r.firma} =====\n${r.cuerpo}`)
await pool.end()
