// ¿Cuántos movimientos no tienen autor? Un user_id NULL (cambios hechos por
// SPs, jobs o backfills) queda FUERA del filtro de los líderes, porque
// "NULL IN (...)" nunca es verdadero. El ADMIN sí los ve.
import { q, pool } from './db.mjs'
console.table((await q(`
  SELECT CASE WHEN user_id IS NULL THEN 'sin autor' ELSE 'con autor' END quien,
         count(*)::int n
    FROM audit_logs GROUP BY 1`)).rows)
console.table((await q(`
  SELECT table_name, action, count(*)::int n FROM audit_logs
   WHERE user_id IS NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 10`)).rows)
await pool.end()
