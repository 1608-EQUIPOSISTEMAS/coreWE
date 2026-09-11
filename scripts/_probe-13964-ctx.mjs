import { q, pool } from './db.mjs'
const { rows } = await q(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_person_resolve'`)
console.log(rows[0]?.def || 'NO EXISTE')
await pool.end()
