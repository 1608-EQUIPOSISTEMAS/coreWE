import { q, pool } from './db.mjs'
const f = await q(`SELECT p.proname, pg_get_functiondef(p.oid) AS def
                     FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                    WHERE t.tgrelid='enrollments'::regclass AND NOT t.tgisinternal`)
console.log(f.rows[0].def)
await pool.end()
