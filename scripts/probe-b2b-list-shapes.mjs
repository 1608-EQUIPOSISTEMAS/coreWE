// Sondeo de forma: los tres *list del modulo b2b. Confirma si cada uno trae
// total_count por fila (envelope paginado) o solo filas planas.
import { pool } from './db.mjs'

const SPS = [
  ['public.sp_b2b_company_list', { page: 1, size: 3 }],
  ['public.sp_company_lead_list', { page: 1, size: 3 }],
  ['public.sp_b2b_contract_list', { page: 1, size: 3 }]
]

const c = await pool.connect()
try {
  for (const [sp, payload] of SPS) {
    await c.query('BEGIN')
    try {
      await c.query(`CALL ${sp}($1::jsonb, 'cur_shape')`, [JSON.stringify(payload)])
      const { rows, fields } = await c.query('FETCH ALL FROM cur_shape')
      console.log(`\n${sp}: ${rows.length} filas`)
      console.log('  columnas:', fields.map(f => f.name).join(', '))
      console.log('  total_count:', rows[0]?.total_count)
    } catch (e) {
      console.log(`\n${sp}: ERROR ${e.message}`)
    }
    await c.query('ROLLBACK')
  }
} finally { c.release(); await pool.end() }
