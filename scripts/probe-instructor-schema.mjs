// Sondeo del dominio instructor: columnas de la tabla, tablas hijas y como
// tratan los SPs los datos anidados (programs / financials.attachments).
// Sirve para decidir donde guardar las carpetas de clase y los usuarios de
// Odoo / Teams sin inventar una forma distinta a la que ya usa el modulo.
import { q, pool } from './db.mjs'

const tablas = await q(`
  SELECT table_name
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'instructor%'
   ORDER BY table_name
`)
console.log('tablas:', tablas.rows.map(r => r.table_name).join(', '))

for (const { table_name } of tablas.rows) {
  const cols = await q(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position
  `, [table_name])
  console.log(`\n— ${table_name} —`)
  console.log(cols.rows.map(c => `${c.column_name}:${c.data_type}`).join(' | '))
}

const sps = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'sp_instructor%'
   ORDER BY 1
`)
console.log('\n— SPs —')
console.table(sps.rows)

await pool.end()
