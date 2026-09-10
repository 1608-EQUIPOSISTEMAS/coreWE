// Linea de tiempo real del caso: que se toco, cuando y quien.
import { q, pool } from './db.mjs'

const { rows } = await q(
  `SELECT id, table_name, record_id, action, user_id, changed_fields, old_data, new_data, created_at
     FROM audit_logs
    WHERE (table_name = 'enrollments' AND record_id = '18729')
       OR (table_name = 'leads' AND record_id = '430165')
    ORDER BY created_at`)
for (const r of rows) {
  console.log(`\n--- ${r.created_at.toISOString()} ${r.table_name} ${r.action} (user ${r.user_id})`)
  if (r.changed_fields) console.log('cambio:', JSON.stringify(r.changed_fields))
}
await pool.end()
