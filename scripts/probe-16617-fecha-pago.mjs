// Verificación post-fix del enrollment 16617 (F.PAGO 17/08).
import { q, pool } from './db.mjs'
const ID = 16617
const { rows: cols } = await q(
  `SELECT attname FROM pg_attribute
    WHERE attrelid = 'mv_enrollment_report_system'::regclass AND attnum > 0 ORDER BY attnum LIMIT 12`)
console.log('COLS mv:', cols.map(c => c.attname).join(' | '))
const { rows } = await q(`SELECT "FECHA DE PAGO", "TIPO DE PAGO" FROM mv_enrollment_report_system WHERE "ID" = $1`, [ID])
console.log('MATVIEW:', rows)
await pool.end()
