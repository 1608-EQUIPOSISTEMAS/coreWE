// One-off: donde mas vive la edicion de un enrollment (para no dejar copias huerfanas).
import { q, pool } from './db.mjs'

const { rows: cols } = await q(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE column_name IN ('program_edition_id', 'edition_num_id')
      AND table_schema = 'public'
    ORDER BY table_name`
)
console.table(cols)

const { rows: enrolCols } = await q(
  `SELECT table_name FROM information_schema.columns
    WHERE column_name = 'enrollment_id' AND table_schema = 'public'
    ORDER BY table_name`
)
console.log('tablas con enrollment_id:', enrolCols.map((r) => r.table_name).join(', '))

await pool.end()
