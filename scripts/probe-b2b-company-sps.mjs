// Que firma tienen de verdad los SPs de empresa y que espera el repositorio.
// Solo lectura, contra la BD que diga Backend/.env (pruebas).
import { q, pool } from './db.mjs'

const { rows: [donde] } = await q('SELECT current_database() AS db, inet_server_port() AS puerto')
console.log('BD:', donde)

const { rows } = await q(
  `SELECT p.proname, p.prokind, pg_get_function_arguments(p.oid) AS argumentos
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'sp_b2b_company%'
    ORDER BY p.proname`)
console.log('\n── SPs de empresa ──')
for (const r of rows) console.log(`${r.prokind === 'p' ? 'PROC' : 'FUNC'}  ${r.proname}(${r.argumentos})`)

await pool.end()
