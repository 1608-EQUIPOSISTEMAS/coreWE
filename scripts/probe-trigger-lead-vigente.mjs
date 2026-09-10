// One-off: version del candado trg_block_update_if_enrolled aplicada en esta BD.
import { q, pool } from './db.mjs'

const { rows } = await q(
  `SELECT pg_get_functiondef(p.oid) AS src
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'trg_block_update_if_enrolled'`
)
console.log(rows[0]?.src ?? 'no encontrado')

const { rows: obs } = await q(
  `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_observed'`
)
console.log('catalog observed =', obs)
await pool.end()
