// Barrido: ¿en qué otras tablas vive el celular viejo del enrollment 16843?
import { q, pool } from './db.mjs'
const VIEJO = '923106478'
const { rows: cols } = await q(`
  SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
   WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     AND c.data_type IN ('text','character varying','character')
     AND c.column_name ~* 'phone|celular|telefono|movil'
   ORDER BY c.table_name`)
for (const { table_name, column_name } of cols) {
  try {
    const { rows } = await q(
      `SELECT count(*)::int n FROM public."${table_name}" WHERE "${column_name}" LIKE '%' || $1 || '%'`, [VIEJO])
    if (rows[0].n) console.log(`HIT  ${table_name}.${column_name}  x${rows[0].n}`)
  } catch (e) { console.log(`skip ${table_name}.${column_name}: ${e.message}`) }
}
await pool.end()
