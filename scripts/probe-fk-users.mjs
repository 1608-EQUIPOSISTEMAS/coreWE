// Quien apunta a public.users y con que regla de borrado. Un DELETE de usuario
// falla si alguna de esas tablas tiene filas suyas con NO ACTION/RESTRICT.
//   node scripts/probe-fk-users.mjs 15
import { q, pool } from './db.mjs'

const userId = Number(process.argv[2] || 0)

const { rows: fks } = await q(`
  SELECT c.conname, c.confdeltype,
         src.relname AS tabla, a.attname AS columna
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class dst ON dst.oid = c.confrelid
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.contype = 'f' AND dst.relname = 'users'
   ORDER BY src.relname, a.attname`)

const REGLA = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }

for (const fk of fks) {
  const { rows } = userId
    ? await q(`SELECT COUNT(*)::int AS n FROM public.${fk.tabla} WHERE ${fk.columna} = $1`, [userId])
    : [{ n: null }]
  console.log(
    `${REGLA[fk.confdeltype].padEnd(10)} ${fk.tabla}.${fk.columna}`.padEnd(60),
    userId ? `filas de ${userId}: ${rows[0].n}` : ''
  )
}
await pool.end()
