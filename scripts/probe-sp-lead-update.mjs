// One-off: ver que columnas de leads escribe sp_comercial_lead_update, para
// entender por que el trigger trg_block_update_if_enrolled bloquea el reenvio
// a FICO de una inscripcion observada (caso lead 430165 / enrollment 18729).
import { q, pool } from './db.mjs'

const { rows } = await q(
  `SELECT pg_get_functiondef(p.oid) AS src
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sp_comercial_lead_update'`
)
console.log(rows[0]?.src ?? 'SP no encontrado')
await pool.end()
